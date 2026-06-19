function money(value) {
  return `USD ${Number(value || 0).toFixed(2)}`;
}

function safe(value) {
  return String(value ?? "").replace(/[\\()]/g, "\\$&").replace(/\r?\n/g, " ");
}

function pdfText(lines) {
  const commands = ["BT", "/F1 10 Tf", "50 780 Td"];
  let first = true;
  for (const line of lines) {
    if (!first) commands.push("0 -16 Td");
    commands.push(`(${safe(line)}) Tj`);
    first = false;
  }
  commands.push("ET");
  return commands.join("\n");
}

function object(id, content) {
  return `${id} 0 obj\n${content}\nendobj\n`;
}

export function generateInvoicePdf({ invoiceNumber, client, rows, totals }) {
  const date = new Date().toLocaleDateString("es-AR");
  const lines = [
    "LUZUNO",
    "Factura A",
    `Comprobante: ${invoiceNumber}`,
    `Fecha: ${date}`,
    "",
    "Emisor: Luzuno - Inteligencia Artificial",
    "Condicion IVA: Responsable Inscripto",
    "",
    `Cliente: ${client.company_name || client.username || "-"}`,
    `CUIT: ${client.cuit || "-"}`,
    `Direccion: ${client.address || "-"}`,
    `Contacto: ${client.contact_person || "-"} - ${client.contact_email || client.email || "-"}`,
    "",
    "Detalle por Anub",
    "Agente | Conversaciones | Duracion media | Costo LLM | Margen | Subtotal"
  ];

  for (const row of rows) {
    lines.push(`${row.agentName} | ${row.conversationCount} | ${row.averageDurationLabel} | ${money(row.llmCostUsd)} | ${money(row.marginUsd)} | ${money(row.subtotalUsd)}`);
  }

  lines.push(
    "",
    `Costo Total de LLM: ${money(totals.llmCostUsd)}`,
    `Margen (${Number(totals.marginPercent || 0).toFixed(2)}%): ${money(totals.marginUsd)}`,
    `Subtotal: ${money(totals.subtotalUsd)}`,
    `IVA 21%: ${money(totals.ivaUsd)}`,
    `IG 3,5%: ${money(totals.igUsd)}`,
    `Total U$D: ${money(totals.totalUsd)}`,
    "",
    "Documento generado por Luzuno AI."
  );

  const stream = pdfText(lines);
  const objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    object(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    object(5, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
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
