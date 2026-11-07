/**
 * Acciones de la app del celular de hospedaje. Cada una recibe el cuerpo ya parseado y devuelve el objeto de respuesta.
 * Se arma con `createHandlers(deps)` para poder probarla completa con un SharePoint simulado.
 *
 * Reglas que NO se negocian en el servidor (el celular solo las muestra):
 *  - Cada acción exige sesión de una persona activa; la sesión muere si se cambia su PIN o se la desactiva.
 *  - El celular nunca decide contrato, casa ni pieza por su cuenta: todo se vuelve a validar contra SharePoint.
 *  - Un día cerrado no se toca hasta que la supervisora lo reabre (y eso queda anotado).
 *  - Todo cambio de un parte ya guardado queda en la bitácora de cambios con quién lo hizo.
 */
const { verifyPin, hashPin, signStaffSession, verifyStaffSession, saltFingerprint } = require('./hash');
const core = require('./hkCore');

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const MAX_FOTO_BASE64_LENGTH = 6 * 1024 * 1024;
const CODE_PATTERN = /^[A-Z]{3}-\d{3,4}$/;
const PIN_PATTERN = /^\d{6}$/;

const BAD_LOGIN = { ok: false, message: 'Código o PIN incorrecto.' };
const SESSION_ENDED = { ok: false, sessionExpired: true, message: 'Tu sesión terminó. Vuelve a entrar con tu código y tu PIN.' };
const GENERIC_ERROR = { ok: false, message: 'No fue posible completar la acción. Inténtalo de nuevo.' };

// Un PIN falso para gastar el mismo tiempo cuando el código no existe (así no se puede distinguir por la demora).
const DUMMY_SALT = '00112233445566778899aabbccddeeff';
const DUMMY_HASH = hashPin('000000', DUMMY_SALT);

function isDuplicateValueError(error) {
  const detail = String((error && error.detail) || '').toLowerCase();
  return detail.includes('already has the value') || detail.includes('valor único') || detail.includes('unique');
}

function extensionFor(contentType) {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return 'jpg';
}

function roomView(room, log, suggestion, sampled) {
  const fields = room.fields;
  const view = {
    id: Number(room.id),
    numero: fields.Title,
    camas: Number(fields.Camas || 0),
    sugerido: suggestion
  };
  if (log) {
    view.parte = {
      ocupacion: log.fields.Ocupacion,
      contratoId: log.fields.ContratoId === undefined || log.fields.ContratoId === null ? null : Number(log.fields.ContratoId),
      personas: Number(log.fields.Personas || 0),
      camas: Number(log.fields.Camas || 0),
      limpiezaDiaria: Boolean(log.fields.LimpiezaDiaria),
      cambioSabanas: Boolean(log.fields.CambioSabanas),
      aseoFondo: Boolean(log.fields.AseoFondo),
      sinDanos: Boolean(log.fields.SinDanos),
      observacion: log.fields.Observacion || '',
      registradoPor: log.fields.RegistradoPor || '',
      modificadoPor: log.fields.ModificadoPor || '',
      revision: log.fields.RevisionResultado || ''
    };
  }
  if (sampled) view.muestra = true;
  return view;
}

function createHandlers(deps) {
  const repo = deps.repo;
  const uploadFile = deps.uploadFile;
  const clock = deps.now || (() => new Date());
  const isoNow = () => clock().toISOString();

  async function authenticate(body) {
    const session = verifyStaffSession(body.sessionToken, clock().getTime());
    if (!session) return { error: SESSION_ENDED };
    const person = await repo.getStaffById(session.personId);
    if (!person || !person.fields.Activo) return { error: SESSION_ENDED };
    if (saltFingerprint(person.fields.PinSalt) !== session.saltFingerprint) return { error: SESSION_ENDED };
    return {
      person: {
        id: Number(person.id),
        codigo: person.fields.Codigo,
        nombre: person.fields.Title,
        rol: person.fields.Rol,
        label: core.staffLabel(person.fields),
        supervision: core.isSupervision(person.fields.Rol)
      }
    };
  }

  /** Carga la casa y valida que exista y tenga piezas: nunca se confía en el id que manda el celular. */
  async function loadHouse(casaId) {
    const id = Number(casaId);
    if (!Number.isInteger(id) || id <= 0) return null;
    const house = await repo.getHouse(id);
    if (!house || !house.fields.Activo) return null;
    return house;
  }

  async function contractOptions(casaId, fecha) {
    const links = core.activeContractLinks(await repo.listContractLinks(casaId), fecha);
    const ids = Array.from(new Set(links.map((link) => Number(link.fields.ContratoId))));
    const options = [];
    for (const contractId of ids) {
      const contract = await repo.getContract(contractId);
      if (!contract) continue;
      const estado = contract.fields.Estado;
      if (estado === 'Terminado' || estado === 'Suspendido') continue;
      const cliente = await repo.getClientName(contract.fields.ClienteId);
      const esOrden = contract.fields.TipoVinculo === 'Orden de servicio';
      options.push({
        id: contractId,
        empresa: cliente || 'Cliente',
        referencia: `${esOrden ? 'OS' : 'Contrato'} ${contract.fields.NumeroContrato || contractId}`
      });
    }
    return options.sort((a, b) => a.empresa.localeCompare(b.empresa, 'es') || a.referencia.localeCompare(b.referencia, 'es'));
  }

  async function addChange(parteId, campo, anterior, nuevo, personLabel) {
    await repo.createChange({
      Title: `${campo}`.slice(0, 255),
      ParteId: Number(parteId),
      Campo: campo,
      ValorAnterior: String(anterior).slice(0, 255),
      ValorNuevo: String(nuevo).slice(0, 255),
      Persona: personLabel,
      FechaCambio: isoNow()
    });
  }

  const handlers = {
    async login(body) {
      const code = typeof body.codigo === 'string' ? body.codigo.trim().toUpperCase() : '';
      const pin = typeof body.pin === 'string' ? body.pin.trim() : '';
      if (!CODE_PATTERN.test(code) || !PIN_PATTERN.test(pin)) {
        verifyPin(PIN_PATTERN.test(pin) ? pin : '000000', DUMMY_SALT, DUMMY_HASH);
        return BAD_LOGIN;
      }
      const person = await repo.findStaffByCode(code);
      if (!person || !person.fields.Activo || !person.fields.PinHash || !person.fields.PinSalt) {
        verifyPin(pin, DUMMY_SALT, DUMMY_HASH);
        return BAD_LOGIN;
      }
      const fields = person.fields;
      const lockedUntil = fields.PinBloqueadoHasta ? new Date(fields.PinBloqueadoHasta).getTime() : 0;
      if (lockedUntil > clock().getTime()) {
        const minutes = Math.ceil((lockedUntil - clock().getTime()) / 60000);
        return { ok: false, message: `Demasiados intentos. Intenta de nuevo en ${minutes} minuto${minutes === 1 ? '' : 's'}.` };
      }
      if (!verifyPin(pin, fields.PinSalt, fields.PinHash)) {
        const attempts = Number(fields.PinIntentosFallidos || 0) + 1;
        if (attempts >= MAX_PIN_ATTEMPTS) {
          await repo.updateStaff(person.id, { PinIntentosFallidos: 0, PinBloqueadoHasta: new Date(clock().getTime() + LOCKOUT_MS).toISOString() });
          return { ok: false, message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(LOCKOUT_MS / 60000)} minutos.` };
        }
        await repo.updateStaff(person.id, { PinIntentosFallidos: attempts });
        return BAD_LOGIN;
      }
      if (Number(fields.PinIntentosFallidos || 0) !== 0 || fields.PinBloqueadoHasta) {
        await repo.updateStaff(person.id, { PinIntentosFallidos: 0, PinBloqueadoHasta: null });
      }
      return {
        ok: true,
        sessionToken: signStaffSession(Number(person.id), fields.PinSalt, clock().getTime()),
        persona: { codigo: fields.Codigo, nombre: fields.Title, rol: fields.Rol, supervision: core.isSupervision(fields.Rol) }
      };
    },

    async houses(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      const houses = await repo.listActiveHouses();
      return {
        ok: true,
        casas: houses
          .map((house) => ({ id: Number(house.id), nombre: house.fields.Title }))
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
      };
    },

    async house(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      const today = core.chileToday(clock());
      const fecha = body.fecha === undefined || body.fecha === '' ? today : body.fecha;
      const dateCheck = core.checkWorkDate(auth.person.rol, fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const casaId = Number(house.id);

      const [roomItems, logs, previous, closure, contracts, supplies, pendingDamages] = await Promise.all([
        repo.listRoomsOfHouse(casaId),
        repo.listDailyByDay(casaId, core.dayNumber(fecha)),
        repo.listDailyBetween(casaId, core.dayNumber(core.addDays(fecha, -core.CARRY_OVER_DAYS)), core.dayNumber(fecha)),
        repo.findClosure(casaId, fecha),
        contractOptions(casaId, fecha),
        repo.listSupplyRequests(casaId),
        auth.person.supervision ? repo.listPendingDamages(casaId) : Promise.resolve([])
      ]);

      const logByRoom = new Map(logs.map((log) => [Number(log.fields.PiezaId), log]));
      const previousByRoom = core.latestLogPerRoom(previous);
      const sample = auth.person.supervision ? core.pickReviewSample(logs, fecha, 3) : new Set();
      const rooms = roomItems
        .filter((room) => room.fields.Activo)
        .sort((a, b) => core.compareRoomNumbers(a.fields.Title, b.fields.Title))
        .map((room) => {
          const roomId = Number(room.id);
          const previousLog = previousByRoom.get(roomId);
          return roomView(room, logByRoom.get(roomId), core.suggestFromPrevious(previousLog && previousLog.fields), sample.has(roomId));
        });

      const sinceMs = clock().getTime() - 7 * 86400000;
      return {
        ok: true,
        casa: { id: casaId, nombre: house.fields.Title },
        fecha,
        hoy: today,
        persona: { codigo: auth.person.codigo, nombre: auth.person.nombre, rol: auth.person.rol, supervision: auth.person.supervision },
        cerrado: Boolean(closure && closure.fields.Vigente !== false && closure.fields.Vigente !== 0)
          ? { por: closure.fields.CerradoPor, cuando: closure.fields.FechaCierre }
          : null,
        contratos: contracts,
        piezas: rooms,
        catalogoInsumos: core.SUPPLY_CATALOG,
        pedidos: supplies
          .filter((item) => new Date(item.fields.FechaSolicitud).getTime() >= sinceMs)
          .sort((a, b) => (a.fields.FechaSolicitud < b.fields.FechaSolicitud ? 1 : -1))
          .slice(0, 15)
          .map((item) => ({
            id: Number(item.id),
            cuando: item.fields.FechaSolicitud,
            pieza: item.fields.PiezaNumero || '',
            detalle: item.fields.Detalle,
            estado: item.fields.Estado,
            por: item.fields.SolicitadoPor
          })),
        danosPorConfirmar: pendingDamages.map((item) => ({
          id: Number(item.id),
          pieza: item.fields.PiezaId,
          descripcion: item.fields.Descripcion,
          reportadoPor: item.fields.ReportadoPor,
          foto: item.fields.FotoUrl || ''
        }))
      };
    },

    async saveRooms(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      const today = core.chileToday(clock());
      const fecha = body.fecha;
      const dateCheck = core.checkWorkDate(auth.person.rol, fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      if (!Array.isArray(body.piezas) || body.piezas.length === 0 || body.piezas.length > 60) {
        return { ok: false, message: 'No hay piezas para guardar.' };
      }
      const casaId = Number(house.id);
      const closure = await repo.findClosure(casaId, fecha);
      if (closure && closure.fields.Vigente !== false && closure.fields.Vigente !== 0) {
        return { ok: false, message: 'El día ya fue cerrado por la supervisora. Pídele que lo reabra para corregirlo.' };
      }

      const [roomItems, logs, contracts] = await Promise.all([
        repo.listRoomsOfHouse(casaId),
        repo.listDailyByDay(casaId, core.dayNumber(fecha)),
        contractOptions(casaId, fecha)
      ]);
      const roomById = new Map(roomItems.filter((room) => room.fields.Activo).map((room) => [Number(room.id), room]));
      const logByRoom = new Map(logs.map((log) => [Number(log.fields.PiezaId), log]));
      const allowedContracts = contracts.map((contract) => contract.id);

      const errors = [];
      let saved = 0;
      for (const input of body.piezas) {
        const piezaId = Number(input && input.piezaId);
        const room = roomById.get(piezaId);
        if (!room) { errors.push({ piezaId, message: 'La pieza no existe en esta casa.' }); continue; }
        const result = core.normalizeRoomInput(input, room.fields, allowedContracts);
        if (!result.ok) { errors.push({ piezaId, numero: room.fields.Title, message: result.message }); continue; }

        const existing = logByRoom.get(piezaId);
        const clave = `${fecha}|${piezaId}`;
        try {
          if (existing) {
            const changes = core.diffRoomLog(existing.fields, result.value);
            if (changes.length === 0) { saved += 1; continue; }
            await repo.updateDaily(existing.id, { ...result.value, ModificadoPor: auth.person.label });
            for (const change of changes) await addChange(existing.id, `Pieza ${room.fields.Title} · ${change.campo}`, change.anterior, change.nuevo, auth.person.label);
          } else {
            let created;
            try {
              created = await repo.createDaily({
                Title: `${fecha} · Pieza ${room.fields.Title}`,
                Fecha: fecha,
                Dia: core.dayNumber(fecha),
                Clave: clave,
                EstablecimientoId: casaId,
                PiezaId: piezaId,
                ...result.value,
                RegistradoPor: auth.person.label
              });
            } catch (error) {
              if (!isDuplicateValueError(error)) throw error;
              // Otra persona guardó la misma pieza al mismo tiempo: se trata como edición, no se pierde ni se duplica.
              const current = (await repo.listDailyByDay(casaId, core.dayNumber(fecha))).find((log) => Number(log.fields.PiezaId) === piezaId);
              if (!current) throw error;
              await repo.updateDaily(current.id, { ...result.value, ModificadoPor: auth.person.label });
              await addChange(current.id, `Pieza ${room.fields.Title} · Registro`, 'Guardado a la vez por otra persona', 'Reemplazado', auth.person.label);
              saved += 1;
              continue;
            }
            await addChange(created.id, `Pieza ${room.fields.Title} · Registro`, '—', `${result.value.Ocupacion}${result.value.ContratoId ? ` · contrato ${result.value.ContratoId}` : ''}`, auth.person.label);
          }
          saved += 1;
        } catch (error) {
          errors.push({ piezaId, numero: room.fields.Title, message: 'No se pudo guardar esta pieza. Inténtalo de nuevo.' });
          if (deps.log) deps.log(error);
        }
      }
      return { ok: errors.length === 0, saved, errors, message: errors.length === 0 ? `${saved} pieza(s) guardada(s).` : 'Algunas piezas no se pudieron guardar.' };
    },

    async closeDay(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Solo la supervisora puede cerrar el día.' };
      const today = core.chileToday(clock());
      const dateCheck = core.checkWorkDate(auth.person.rol, body.fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const casaId = Number(house.id);
      const fecha = body.fecha;

      const existing = await repo.findClosure(casaId, fecha);
      if (existing && existing.fields.Vigente !== false && existing.fields.Vigente !== 0) {
        return { ok: false, message: 'Este día ya está cerrado.' };
      }
      const [roomItems, logs] = await Promise.all([repo.listRoomsOfHouse(casaId), repo.listDailyByDay(casaId, core.dayNumber(fecha))]);
      const logged = new Set(logs.map((log) => Number(log.fields.PiezaId)));
      const missing = roomItems
        .filter((room) => room.fields.Activo && !logged.has(Number(room.id)))
        .map((room) => room.fields.Title)
        .sort(core.compareRoomNumbers);
      if (missing.length > 0) {
        return { ok: false, message: `Faltan piezas por registrar: ${missing.join(', ')}.`, faltan: missing };
      }
      const observation = typeof body.observacion === 'string' ? body.observacion.trim().slice(0, 500) : '';
      const fields = {
        Vigente: true,
        CerradoPor: auth.person.label,
        FechaCierre: isoNow(),
        Observacion: observation,
        ReabiertoPor: null,
        MotivoReapertura: null
      };
      if (existing) {
        await repo.updateClosure(existing.id, fields);
      } else {
        await repo.createClosure({
          Title: `${fecha} · ${house.fields.Title}`,
          Fecha: fecha,
          Dia: core.dayNumber(fecha),
          Clave: `${fecha}|${casaId}`,
          EstablecimientoId: casaId,
          ...fields
        });
      }
      return { ok: true, message: `Día ${fecha} cerrado en ${house.fields.Title}.` };
    },

    async reopenDay(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Solo la supervisora puede reabrir un día.' };
      const today = core.chileToday(clock());
      const dateCheck = core.checkWorkDate(auth.person.rol, body.fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const reason = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 500) : '';
      if (reason.length < 5) return { ok: false, message: 'Escribe por qué se reabre el día.' };
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const closure = await repo.findClosure(Number(house.id), body.fecha);
      if (!closure || closure.fields.Vigente === false || closure.fields.Vigente === 0) return { ok: false, message: 'Este día no está cerrado.' };
      await repo.updateClosure(closure.id, { Vigente: false, ReabiertoPor: auth.person.label, MotivoReapertura: reason });
      return { ok: true, message: 'Día reabierto. Recuerda volver a cerrarlo cuando termines.' };
    },

    async reviewRoom(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Solo la supervisora puede revisar piezas.' };
      const today = core.chileToday(clock());
      const dateCheck = core.checkWorkDate(auth.person.rol, body.fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const result = body.resultado === 'Conforme' || body.resultado === 'Observada' ? body.resultado : '';
      if (!result) return { ok: false, message: 'Indica si la pieza está conforme u observada.' };
      const note = typeof body.nota === 'string' ? body.nota.trim().slice(0, 500) : '';
      if (result === 'Observada' && !note) return { ok: false, message: 'Si la pieza queda observada, escribe qué falta.' };
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const casaId = Number(house.id);
      const piezaId = Number(body.piezaId);
      const log = (await repo.listDailyByDay(casaId, core.dayNumber(body.fecha))).find((item) => Number(item.fields.PiezaId) === piezaId);
      if (!log) return { ok: false, message: 'Esa pieza no tiene parte registrado ese día.' };
      await repo.updateDaily(log.id, { RevisadoPor: auth.person.label, RevisionResultado: result, RevisionNota: note });
      await addChange(log.id, 'Revisión de la supervisora', log.fields.RevisionResultado || '—', result, auth.person.label);
      return { ok: true, message: 'Revisión guardada.' };
    },

    async reportDamage(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      const today = core.chileToday(clock());
      const fecha = body.fecha === undefined || body.fecha === '' ? today : body.fecha;
      const dateCheck = core.checkWorkDate(auth.person.rol, fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const tipo = core.TIPOS_DANO.includes(body.tipo) ? body.tipo : '';
      const description = typeof body.descripcion === 'string' ? body.descripcion.trim().slice(0, 1000) : '';
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim().slice(0, 60) : '';
      const fotoBase64 = typeof body.fotoBase64 === 'string' ? body.fotoBase64 : '';
      const fotoContentType = typeof body.fotoContentType === 'string' ? body.fotoContentType : 'image/jpeg';
      if (!tipo) return { ok: false, message: 'Indica si es desgaste o posible mal uso.' };
      if (description.length < 5) return { ok: false, message: 'Describe el daño con unas palabras.' };
      if (!submissionId) return { ok: false, message: 'No fue posible registrar el daño.' };
      if (tipo === 'Posible mal uso' && !fotoBase64) return { ok: false, message: 'Un posible mal uso necesita una foto. Toma la foto y vuelve a enviar.' };
      if (fotoBase64.length > MAX_FOTO_BASE64_LENGTH) return { ok: false, message: 'La foto es demasiado grande. Inténtalo de nuevo.' };

      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const casaId = Number(house.id);
      const roomItems = await repo.listRoomsOfHouse(casaId);
      const piezaId = Number(body.piezaId);
      const room = roomItems.find((item) => Number(item.id) === piezaId && item.fields.Activo);
      if (!room) return { ok: false, message: 'La pieza no existe en esta casa.' };

      const log = (await repo.listDailyByDay(casaId, core.dayNumber(fecha))).find((item) => Number(item.fields.PiezaId) === piezaId);
      const contratoId = log && log.fields.ContratoId ? Number(log.fields.ContratoId) : undefined;

      let fotoUrl;
      if (fotoBase64) {
        const buffer = Buffer.from(fotoBase64, 'base64');
        const path = `DanosFotos/${casaId}/${Date.now()}-${submissionId}.${extensionFor(fotoContentType)}`;
        fotoUrl = await uploadFile(path, buffer, fotoContentType);
      }

      const malUso = tipo === 'Posible mal uso';
      try {
        await repo.createIncident({
          Title: `Pieza ${room.fields.Title} · ${tipo}`.slice(0, 255),
          EstablecimientoId: casaId,
          Tipo: 'Mantenimiento',
          Descripcion: `Pieza ${room.fields.Title}: ${description}`,
          ReportadoPor: auth.person.label,
          Prioridad: malUso ? 'Alta' : 'Media',
          AfectaContinuidad: false,
          Estado: 'Reportado',
          FotoUrl: fotoUrl,
          CanalIngreso: 'Formulario externo',
          CodigoCanal: 'APP-HOSPEDAJE',
          SubmissionId: submissionId,
          PiezaId: piezaId,
          TipoDano: tipo,
          ContratoId: contratoId,
          ConfirmacionDano: malUso ? 'Por confirmar' : undefined,
          EstadoCobro: malUso ? undefined : 'No aplica'
        });
      } catch (error) {
        if (!isDuplicateValueError(error)) throw error;
        // Doble toque: ya estaba registrado, es éxito.
      }
      return {
        ok: true,
        message: malUso
          ? 'Daño registrado. La supervisora debe confirmarlo y avisar al cliente de inmediato.'
          : 'Daño por desgaste registrado. Mantención lo verá.'
      };
    },

    async decideDamage(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Solo la supervisora puede confirmar un daño.' };
      const decision = body.decision === 'mal-uso' ? 'Mal uso confirmado' : body.decision === 'desgaste' ? 'Era desgaste' : '';
      if (!decision) return { ok: false, message: 'Indica si se confirma el mal uso o si era desgaste.' };
      const note = typeof body.nota === 'string' ? body.nota.trim().slice(0, 500) : '';
      const incident = await repo.getIncident(body.incidenteId);
      if (!incident || incident.fields.ConfirmacionDano !== 'Por confirmar') return { ok: false, message: 'Este daño ya fue resuelto o no existe.' };
      const stamp = `${isoNow().slice(0, 10)} · ${auth.person.label}: ${decision}${note ? ` — ${note}` : ''}`;
      const previousNote = incident.fields.Observacion ? `${incident.fields.Observacion}\n` : '';
      await repo.updateIncident(incident.id, {
        ConfirmacionDano: decision,
        ConfirmadoPor: auth.person.label,
        FechaConfirmacion: isoNow(),
        EstadoCobro: decision === 'Mal uso confirmado' ? 'Por revisar' : 'No aplica',
        Observacion: `${previousNote}${stamp}`
      });
      return {
        ok: true,
        message: decision === 'Mal uso confirmado'
          ? 'Mal uso confirmado. Avisa al cliente hoy mismo: en el ERP quedó el aviso listo para copiar.'
          : 'Quedó como desgaste: no se cobra.'
      };
    },

    async requestSupplies(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      const house = await loadHouse(body.casaId);
      if (!house) return { ok: false, message: 'No se encontró la casa.' };
      const casaId = Number(house.id);
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim().slice(0, 60) : '';
      if (!submissionId) return { ok: false, message: 'No fue posible registrar el pedido.' };
      const formatted = core.formatSupplyRequest(body.items);
      if (!formatted.ok) return { ok: false, message: formatted.message };

      let roomId;
      let roomNumber = '';
      if (body.piezaId !== undefined && body.piezaId !== null && body.piezaId !== '') {
        const roomItems = await repo.listRoomsOfHouse(casaId);
        const room = roomItems.find((item) => Number(item.id) === Number(body.piezaId) && item.fields.Activo);
        if (!room) return { ok: false, message: 'La pieza no existe en esta casa.' };
        roomId = Number(room.id);
        roomNumber = room.fields.Title;
      }
      const note = typeof body.nota === 'string' ? body.nota.trim().slice(0, 300) : '';
      const detail = note ? `${formatted.detail}\nNota: ${note}` : formatted.detail;
      try {
        await repo.createSupplyRequest({
          Title: `${house.fields.Title} · ${core.chileToday(clock())}${roomNumber ? ` · pieza ${roomNumber}` : ''}`.slice(0, 255),
          EstablecimientoId: casaId,
          PiezaId: roomId,
          PiezaNumero: roomNumber || undefined,
          Detalle: detail,
          Estado: 'Pendiente',
          SolicitadoPor: auth.person.label,
          SolicitadoPorCodigo: auth.person.codigo,
          FechaSolicitud: isoNow(),
          SubmissionId: submissionId
        });
      } catch (error) {
        if (!isDuplicateValueError(error)) throw error;
      }
      return { ok: true, message: `Pedido enviado a Bodega para ${house.fields.Title}.` };
    },

    /* ---------- Registros BPM: la supervisora sube la foto de la hoja y anota mínima/máxima o «fuera de límite» ---------- */

    async bpmList(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Los registros BPM los sube la supervisora.' };
      const today = core.chileToday(clock());
      const fecha = body.fecha === undefined || body.fecha === '' ? today : body.fecha;
      const dateCheck = core.checkWorkDate(auth.person.rol, fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const formats = (await repo.listBpmFormats()).map(core.parseBpmFormat).filter((format) => format.activo && format.codigo !== '');
      formats.sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
      const records = await repo.listBpmRecordsByDay(core.dayNumber(fecha));
      return {
        ok: true,
        fecha,
        hoy: today,
        formatos: formats.map((format) => {
          const done = records.filter((item) => item.fields.CodigoFormato === format.codigo);
          return {
            codigo: format.codigo,
            nombre: format.nombre,
            area: format.area,
            frecuencia: format.frecuencia,
            tomas: format.tomas,
            tipo: format.tipo,
            puntos: format.puntos,
            instruccion: format.instruccion,
            hechos: done.map((item) => ({
              turno: item.fields.Turno || '',
              punto: item.fields.Punto || '',
              lugar: item.fields.Lugar || '',
              resultado: item.fields.Resultado || '',
              por: item.fields.RegistradoPor || ''
            }))
          };
        })
      };
    },

    async bpmRecord(body) {
      const auth = await authenticate(body);
      if (auth.error) return auth.error;
      if (!auth.person.supervision) return { ok: false, message: 'Los registros BPM los sube la supervisora.' };
      const today = core.chileToday(clock());
      const fecha = body.fecha === undefined || body.fecha === '' ? today : body.fecha;
      const dateCheck = core.checkWorkDate(auth.person.rol, fecha, today);
      if (!dateCheck.ok) return { ok: false, message: dateCheck.message };
      const submissionId = typeof body.submissionId === 'string' ? body.submissionId.trim().slice(0, 60) : '';
      if (!submissionId) return { ok: false, message: 'No fue posible registrar la hoja.' };
      const fotoBase64 = typeof body.fotoBase64 === 'string' ? body.fotoBase64 : '';
      const fotoContentType = typeof body.fotoContentType === 'string' ? body.fotoContentType : 'image/jpeg';
      if (!fotoBase64) return { ok: false, message: 'Saca una foto de la hoja: la foto es el registro.' };
      if (fotoBase64.length > MAX_FOTO_BASE64_LENGTH) return { ok: false, message: 'La foto es demasiado grande. Inténtalo de nuevo.' };

      const code = typeof body.codigo === 'string' ? body.codigo.trim() : '';
      const format = (await repo.listBpmFormats()).map(core.parseBpmFormat).find((item) => item.activo && item.codigo === code);
      if (!format) return { ok: false, message: 'Ese formato no existe o está desactivado.' };
      const evaluated = core.evaluateBpm(format, body);
      if (!evaluated.ok) return { ok: false, message: evaluated.message };

      const buffer = Buffer.from(fotoBase64, 'base64');
      const path = `BpmFotos/${fecha.slice(0, 7)}/${format.codigo}-${fecha}-${Date.now()}-${submissionId}.${extensionFor(fotoContentType)}`;
      const fotoUrl = await uploadFile(path, buffer, fotoContentType);
      const detail = [evaluated.value.Punto, evaluated.value.Lugar].filter((part) => part).join(' · ');
      try {
        await repo.createBpmRecord({
          Title: `${format.codigo} · ${fecha}${detail ? ` · ${detail}` : ''}`.slice(0, 255),
          CodigoFormato: format.codigo,
          NombreFormato: format.nombre,
          Fecha: fecha,
          Dia: core.dayNumber(fecha),
          ...evaluated.value,
          FotoUrl: fotoUrl,
          RegistradoPor: auth.person.label,
          RegistradoPorCodigo: auth.person.codigo,
          FechaRegistro: isoNow(),
          SubmissionId: submissionId
        });
      } catch (error) {
        if (!isDuplicateValueError(error)) throw error;
        // Doble toque: la hoja ya estaba guardada.
      }
      const fuera = evaluated.value.Resultado === core.BPM_RESULTADOS.fuera;
      return {
        ok: true,
        fuera,
        message: fuera
          ? 'Hoja guardada como FUERA DE LÍMITE. Quedó pendiente una acción correctiva en el ERP: avisa al Jefe de Operaciones.'
          : `Hoja guardada (${format.codigo}).`
      };
    }
  };

  return handlers;
}

const ACTIONS = {
  login: 'login',
  houses: 'houses',
  house: 'house',
  'save-rooms': 'saveRooms',
  'close-day': 'closeDay',
  'reopen-day': 'reopenDay',
  'review-room': 'reviewRoom',
  'report-damage': 'reportDamage',
  'decide-damage': 'decideDamage',
  'request-supplies': 'requestSupplies',
  'bpm-list': 'bpmList',
  'bpm-record': 'bpmRecord'
};

module.exports = { createHandlers, ACTIONS, GENERIC_ERROR };
