const assert = require('assert');
const zlib = require('zlib');
const Plantilla = require('../../plantilla');
const { validatePlan } = require('./planCore');

const cfg = {
  cliente: 'MANTOS GROUP',
  codigo: 'ICH-CTR-2026-000005',
  descripcion: 'Campamento norte',
  horaCierre: '18:00',
  horasAnticipacion: 24,
  servicios: ['Desayuno', 'Almuerzo', 'Cena', 'Colación Terreno'],
  inicio: '2026-10-14',
  dias: 10,
  diasServicio: []
};

// Zip comprimido (como lo guarda Excel de verdad) para probar el lector con método 8.
function zipDeflate(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(data);
    const comp = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, comp);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end]));
}

const unzipToText = async (bytes) => {
  const zip = await Plantilla._readZip(bytes);
  const out = {};
  for (const [k, v] of Object.entries(zip)) out[k] = Buffer.from(v).toString('utf8');
  return out;
};

(async () => {
  const bytes = Plantilla.build(cfg);
  const files = await unzipToText(bytes);

  // La plantilla trae las partes mínimas y está bien formada (el CRC lo valida el lector de Node al abrirla).
  for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
    assert.ok(files[name], `falta ${name}`);
  }
  assert.ok(/Código de la plantilla/.test(files['xl/worksheets/sheet1.xml']));
  assert.ok(/ICH-CTR-2026-000005/.test(files['xl/worksheets/sheet1.xml']));
  assert.ok(/hasta las 18:00 del día anterior/.test(files['xl/worksheets/sheet1.xml']));
  // Las colaciones no son columna en «Pedidos»: van en su hoja.
  assert.ok(!/Colación/.test(files['xl/worksheets/sheet2.xml']));
  assert.ok(/Colación Terreno/.test(files['xl/worksheets/sheet3.xml']));

  // Plantilla vacía → no produce cantidades (las casillas en blanco no cuentan).
  const vacia = await Plantilla.read(bytes);
  assert.strictEqual(vacia.codigo, 'ICH-CTR-2026-000005');
  assert.strictEqual(vacia.dias.length, 0);
  assert.deepStrictEqual(vacia.errores, []);

  // Llenarla como lo haría el cliente: Desayuno 4 el 14-10, Cena 0 el 15-10, almuerzo 6 el 16-10, dos colaciones.
  const sheet2 = files['xl/worksheets/sheet2.xml']
    .replace('<c r="C2" s="5"/>', '<c r="C2" s="5"><v>4</v></c>')
    .replace('<c r="E3" s="5"/>', '<c r="E3" s="5"><v>0</v></c>')
    .replace('<c r="D4" s="5"/>', '<c r="D4" s="5"><v>6</v></c>');
  assert.notStrictEqual(sheet2, files['xl/worksheets/sheet2.xml']);
  const sheet3 = files['xl/worksheets/sheet3.xml']
    .replace('<c r="A2" s="3"/>', '<c r="A2" s="3"><v>46309</v></c>') // 2026-10-14
    .replace('<c r="B2" s="9"/>', '<c r="B2" s="9" t="inlineStr"><is><t>06:30</t></is></c>')
    .replace('<c r="C2" s="9"/>', '<c r="C2" s="9" t="inlineStr"><is><t>Colación Terreno</t></is></c>')
    .replace('<c r="D2" s="5"/>', '<c r="D2" s="5"><v>12</v></c>')
    .replace('<c r="A3" s="3"/>', '<c r="A3" s="3" t="inlineStr"><is><t>15-10-2026</t></is></c>')
    .replace('<c r="B3" s="9"/>', '<c r="B3" s="9"><v>0.75</v></c>') // 18:00 como hora de Excel
    .replace('<c r="C3" s="9"/>', '<c r="C3" s="9" t="inlineStr"><is><t>Colación Terreno</t></is></c>')
    .replace('<c r="D3" s="5"/>', '<c r="D3" s="5"><v>5</v></c>');
  assert.notStrictEqual(sheet3, files['xl/worksheets/sheet3.xml']);

  // Reempacado con compresión real y textos como «cadenas compartidas», como lo deja Excel.
  const filled = { ...files, 'xl/worksheets/sheet2.xml': sheet2, 'xl/worksheets/sheet3.xml': sheet3 };
  const leido = await Plantilla.read(zipDeflate(filled));
  assert.deepStrictEqual(leido.errores, []);
  assert.strictEqual(leido.codigo, 'ICH-CTR-2026-000005');
  const por = Object.fromEntries(leido.dias.map((d) => [d.fecha, d.servicios]));
  assert.deepStrictEqual(por['2026-10-14'], [{ tipoServicio: 'Desayuno', cantidad: 4 }, { tipoServicio: 'Colación Terreno', cantidad: 12, horario: '06:30' }]);
  assert.deepStrictEqual(por['2026-10-15'], [{ tipoServicio: 'Cena', cantidad: 0 }, { tipoServicio: 'Colación Terreno', cantidad: 5, horario: '18:00' }]);
  assert.deepStrictEqual(por['2026-10-16'], [{ tipoServicio: 'Almuerzo', cantidad: 6 }]);

  // Y lo leído pasa por la validación del servidor.
  const now = new Date('2026-10-13T13:00:00Z');
  const v = validatePlan({ dias: leido.dias, permitted: cfg.servicios, now, horaCierre: '18:00', horasAnticipacion: 24 });
  assert.strictEqual(v.ok, true, JSON.stringify(v.errores));
  assert.deepStrictEqual(v.resumen, { dias: 3, filas: 5, fueraDePlazo: 0, ceros: 1 });

  // Cantidades inválidas se informan con su ubicación (no se pierden en silencio).
  const mala = await Plantilla.read(zipDeflate({
    ...files,
    'xl/worksheets/sheet2.xml': files['xl/worksheets/sheet2.xml'].replace('<c r="C2" s="5"/>', '<c r="C2" s="5" t="inlineStr"><is><t>muchos</t></is></c>').replace('<c r="D2" s="5"/>', '<c r="D2" s="5"><v>2.5</v></c>')
  }));
  assert.strictEqual(mala.errores.length, 2);
  assert.ok(/Pedidos!C2/.test(mala.errores[0]));

  // Colación incompleta (sin horario) se informa.
  const incompleta = await Plantilla.read(zipDeflate({
    ...files,
    'xl/worksheets/sheet3.xml': files['xl/worksheets/sheet3.xml'].replace('<c r="D2" s="5"/>', '<c r="D2" s="5"><v>3</v></c>')
  }));
  assert.ok(incompleta.errores.some((e) => /Colaciones/.test(e)));

  // Días de servicio: la plantilla omite los días sin servicio.
  const lunVie = await unzipToText(Plantilla.build({ ...cfg, diasServicio: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'], dias: 14 }));
  assert.ok(!/Sábado|Domingo/.test(lunVie['xl/worksheets/sheet2.xml']));

  // Sin colaciones autorizadas no hay hoja «Colaciones».
  const sinCol = await unzipToText(Plantilla.build({ ...cfg, servicios: ['Desayuno', 'Cena'] }));
  assert.ok(!sinCol['xl/worksheets/sheet3.xml']);

  // Archivos que no son Excel: error claro, nunca una excepción rara.
  await assert.rejects(() => Plantilla.read(new Uint8Array([1, 2, 3, 4, 5])), /no parece un Excel/);
  await assert.rejects(() => Plantilla.read(zipDeflate({ 'hola.txt': 'hola' })), /no parece una plantilla/);

  // Plazo en texto: 24 h = día anterior; 48 h = dos días.
  assert.ok(/día anterior/.test(Plantilla.textoPlazo('18:00', 24)));
  assert.ok(/2 días de anticipación/.test(Plantilla.textoPlazo('18:00', 48)));

  console.log('Todas las pruebas de la plantilla Excel pasaron.');
})().catch((e) => { console.error(e); process.exit(1); });
