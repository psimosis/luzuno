import fs from "node:fs";
import zlib from "node:zlib";

function money(value) {
  return `USD ${Number(value || 0).toFixed(4)}`;
}

function safe(value) {
  return String(value ?? "").replace(/[\\()]/g, "\\$&").replace(/\r?\n/g, " ");
}

function text(x, y, value, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${safe(value)}) Tj ET`;
}

function rect(x, y, width, height) {
  return `${x} ${y} ${width} ${height} re S`;
}

function line(x1, y1, x2, y2) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function image(name, x, y, width, height) {
  return `q ${width} 0 0 ${height} ${x} ${y} cm /${name} Do Q`;
}

function object(id, content) {
  return `${id} 0 obj\n${content}\nendobj\n`;
}

function rowText(value, max = 52) {
  const textValue = String(value || "-");
  return textValue.length > max ? `${textValue.slice(0, max - 3)}...` : textValue;
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function decodePngRgba(filePath) {
  const png = fs.readFileSync(filePath);
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Invalid PNG logo.");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const chunks = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error("Interlaced PNG logos are not supported.");
    }
    if (type === "IDAT") chunks.push(data);
    if (type === "IEND") break;
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error("Logo PNG must be 8-bit RGBA.");

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = zlib.inflateSync(Buffer.concat(chunks));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;
    const previousRow = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    const currentRow = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? currentRow[x - bytesPerPixel] : 0;
      const up = previousRow ? previousRow[x] : 0;
      const upLeft = previousRow && x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paethPredictor(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}.`);
      currentRow[x] = (row[x] + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

function logoImageObject() {
  const { width, height, pixels } = decodePngRgba(new URL("../public/logo-luzuno.png", import.meta.url));
  const targetWidth = 330;
  const targetHeight = Math.round(targetWidth * height / width);
  const rgb = Buffer.alloc(targetWidth * targetHeight * 3);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor(y * height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor(x * width / targetWidth));
      const source = (sourceY * width + sourceX) * 4;
      const target = (y * targetWidth + x) * 3;
      const alpha = pixels[source + 3] / 255;
      rgb[target] = Math.round(pixels[source] * alpha + 255 * (1 - alpha));
      rgb[target + 1] = Math.round(pixels[source + 1] * alpha + 255 * (1 - alpha));
      rgb[target + 2] = Math.round(pixels[source + 2] * alpha + 255 * (1 - alpha));
    }
  }
  const compressedHex = zlib.deflateSync(rgb).toString("hex").toUpperCase();
  const stream = `${compressedHex}>`;
  return {
    name: "Logo",
    object: object(7, `<< /Type /XObject /Subtype /Image /Width ${targetWidth} /Height ${targetHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /FlateDecode] /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  };
}

export function generateInvoicePdf({ invoiceNumber, invoiceType = "A", period = {}, client, rows = [], concepts = [], totals = {} }) {
  const date = new Date().toLocaleDateString("es-AR");
  const title = invoiceType === "A" ? "FACTURA" : "DOCUMENTO X";
  const subtitle = invoiceType === "A" ? "" : "NO VALIDO COMO FACTURA";
  const logo = logoImageObject();
  const commands = [
    "0.07 0.22 0.34 RG",
    "1.2 w",
    rect(36, 715, 523, 90),
    rect(278, 715, 42, 90),
    image(logo.name, 58, 731, 170, 57),
    text(292, 768, invoiceType, 28, "F2"),
    text(340, 780, title, 18, "F2"),
    text(340, 762, subtitle, 9, "F2"),
    text(340, 742, `Comprobante: ${invoiceNumber}`, 10),
    text(340, 728, `Fecha: ${date}`, 10),
    text(340, 716, `Periodo: ${period.label || "-"}`, 10),

    rect(36, 628, 523, 82),
    text(50, 690, "Datos del Cliente", 12, "F2"),
    text(50, 672, `Razon Social: ${client.company_name || client.username || "-"}`, 10),
    text(50, 656, `CUIT: ${client.cuit || "-"}`, 10),
    text(50, 640, `Direccion: ${client.address || "-"}`, 10),
    text(310, 672, `Contacto: ${client.contact_person || "-"}`, 10),
    text(310, 656, `Email: ${client.contact_email || client.email || "-"}`, 10),
    text(310, 640, `Telefono: ${client.phone || "-"}`, 10),

    rect(36, 145, 523, 465),
    text(50, 590, "Detalle", 12, "F2"),
    line(36, 575, 559, 575),
    text(50, 558, "Descripcion", 9, "F2"),
    text(312, 558, "Minutos", 9, "F2"),
    text(382, 558, "U$D Min", 9, "F2"),
    text(482, 558, "Importe", 9, "F2"),
    line(36, 548, 559, 548)
  ];

  let y = 530;
  const detailRows = [
    ...rows.map((row) => ({
      description: `Servicio Anub ${row.agentName}`,
      minutes: Number(row.totalMinutes || 0).toFixed(4),
      rate: money(row.billedCostPerMinuteUsd),
      amount: money(row.subtotalUsd)
    })),
    ...concepts.map((concept) => ({
      description: concept.description,
      minutes: "-",
      rate: "-",
      amount: money(concept.amount_usd)
    }))
  ];

  for (const row of detailRows.slice(0, 18)) {
    commands.push(text(50, y, rowText(row.description, 48), 9));
    commands.push(text(318, y, row.minutes, 9));
    commands.push(text(386, y, row.rate, 9));
    commands.push(text(482, y, row.amount, 9));
    commands.push(line(36, y - 9, 559, y - 9));
    y -= 22;
  }
  if (!detailRows.length) {
    commands.push(text(50, y, "Sin consumos para facturar.", 10));
  }

  commands.push(
    rect(338, 52, 221, 82),
    text(356, 112, "Subtotal", 10, "F2"),
    text(494, 112, money(totals.subtotalUsd), 10),
    text(356, 94, "IVA 21%", 10, "F2"),
    text(494, 94, money(totals.ivaUsd), 10),
    text(356, 76, "IG 3,5%", 10, "F2"),
    text(494, 76, money(totals.igUsd), 10),
    line(338, 70, 559, 70),
    text(356, 56, "Total U$D", 12, "F2"),
    text(486, 56, money(totals.totalUsd), 12, "F2"),
    rect(36, 52, 286, 82),
    text(50, 112, "Emisor", 10, "F2"),
    text(50, 94, "Luzuno - Servicios de Inteligencia Artificial", 9),
    text(50, 78, "Condicion IVA: Responsable Inscripto", 9),
    text(50, 62, "Documento generado por Luzuno AI.", 9)
  );

  const stream = commands.join("\n");
  const objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Logo 7 0 R >> >> /Contents 6 0 R >>"),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
    object(6, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`),
    logo.object
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const item of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += item;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}
