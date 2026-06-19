function money(value) {
  return `USD ${Number(value || 0).toFixed(2)}`;
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

function object(id, content) {
  return `${id} 0 obj\n${content}\nendobj\n`;
}

function rowText(value, max = 52) {
  const textValue = String(value || "-");
  return textValue.length > max ? `${textValue.slice(0, max - 3)}...` : textValue;
}

export function generateInvoicePdf({ invoiceNumber, invoiceType = "A", period = {}, client, rows, totals }) {
  const date = new Date().toLocaleDateString("es-AR");
  const title = invoiceType === "A" ? "FACTURA" : "DOCUMENTO X";
  const subtitle = invoiceType === "A" ? "" : "NO VALIDO COMO FACTURA";
  const commands = [
    "0.07 0.22 0.34 RG",
    "1.2 w",
    rect(36, 725, 523, 80),
    rect(278, 725, 42, 80),
    text(58, 770, "luzuno", 30, "F2"),
    text(58, 750, "Inteligencia Artificial", 10),
    text(292, 770, invoiceType, 28, "F2"),
    text(340, 780, title, 18, "F2"),
    text(340, 766, subtitle, 9, "F2"),
    text(340, 760, `Comprobante: ${invoiceNumber}`, 10),
    text(340, 744, `Fecha: ${date}`, 10),
    text(340, 730, `Periodo: ${period.label || "-"}`, 10),

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
  for (const row of rows.slice(0, 18)) {
    commands.push(text(50, y, rowText(`Servicio Anub ${row.agentName}`, 48), 9));
    commands.push(text(318, y, Number(row.totalMinutes || 0).toFixed(2), 9));
    commands.push(text(386, y, money(row.billedCostPerMinuteUsd), 9));
    commands.push(text(482, y, money(row.subtotalUsd), 9));
    commands.push(line(36, y - 9, 559, y - 9));
    y -= 22;
  }
  if (!rows.length) {
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
    object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>"),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    object(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
    object(6, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
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
