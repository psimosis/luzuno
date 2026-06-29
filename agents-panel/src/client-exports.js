function value(text) {
  return String(text ?? "").trim();
}

function number4(text) {
  return Number(text || 0).toFixed(4);
}

function clientName(user, local) {
  return value(local.company_name) || (user.username === "panel-admin" ? "Luzuno" : value(user.username));
}

export function clientExportRows(users = [], localUsers = []) {
  const localById = new Map(localUsers.map((item) => [item.user_id, item]));
  return users.map((user) => {
    const local = localById.get(user.id) || {};
    return {
      companyName: clientName(user, local),
      cuit: value(local.cuit),
      address: value(local.address),
      phone: value(local.phone),
      contactPerson: value(local.contact_person),
      contactEmail: value(local.contact_email || user.email),
      username: value(user.username || local.username),
      accessEmail: value(user.email || local.email),
      marginPercent: number4(local.margin_percent),
      costPerMinuteUsd: number4(local.cost_per_minute_usd),
      elevenLabsApiKey: local.api_key_last4 ? `Configurada ****${local.api_key_last4}` : "No configurada"
    };
  });
}

function csvCell(text) {
  const raw = String(text ?? "");
  return /[",\r\n;]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}

export function generateClientsCsv(rows) {
  const headers = [
    "Nombre de la Empresa",
    "CUIT",
    "Direccion",
    "Telefono",
    "Persona de Contacto",
    "Correo Electronico",
    "Nombre de Usuario",
    "Email de Acceso",
    "Margen %",
    "u$s Min",
    "API ElevenLabs"
  ];
  const lines = [
    headers.map(csvCell).join(";"),
    ...rows.map((row) => [
      row.companyName,
      row.cuit,
      row.address,
      row.phone,
      row.contactPerson,
      row.contactEmail,
      row.username,
      row.accessEmail,
      row.marginPercent,
      row.costPerMinuteUsd,
      row.elevenLabsApiKey
    ].map(csvCell).join(";"))
  ];
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

function pdfSafe(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/[\\()]/g, "\\$&")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text, max) {
  const clean = pdfSafe(text);
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

function text(x, y, content, size = 9, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${pdfSafe(content)}) Tj ET`;
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

function clientBlock(row, y) {
  return [
    rect(34, y - 82, 774, 88),
    text(48, y - 13, clip(row.companyName || "-", 48), 12, "F2"),
    text(48, y - 30, `CUIT: ${row.cuit || "-"}`),
    text(48, y - 45, `Direccion: ${clip(row.address || "-", 58)}`),
    text(48, y - 60, `Telefono: ${row.phone || "-"}`),
    text(360, y - 30, `Contacto: ${clip(row.contactPerson || "-", 36)}`),
    text(360, y - 45, `Correo: ${clip(row.contactEmail || "-", 42)}`),
    text(360, y - 60, `Usuario: ${clip(row.username || "-", 34)}`),
    text(610, y - 30, `Email acceso: ${clip(row.accessEmail || "-", 28)}`),
    text(610, y - 45, `Margen: ${row.marginPercent}%`),
    text(610, y - 60, `u$s Min: ${row.costPerMinuteUsd}`),
    text(610, y - 75, clip(row.elevenLabsApiKey || "-", 30))
  ];
}

function pageCommands(rows, pageNumber, pageCount) {
  const commands = [
    "0.07 0.22 0.34 RG",
    "1 w",
    text(34, 560, "Luzuno AI", 16, "F2"),
    text(34, 540, "Listado de Clientes", 18, "F2"),
    text(34, 522, `Fecha: ${new Date().toLocaleDateString("es-AR")}`),
    text(716, 522, `Pagina ${pageNumber} de ${pageCount}`),
    line(34, 512, 808, 512)
  ];
  let y = 486;
  for (const row of rows) {
    commands.push(...clientBlock(row, y));
    y -= 94;
  }
  return commands.join("\n");
}

export function generateClientsPdf(rows) {
  const pageSize = 5;
  const pages = [];
  for (let index = 0; index < Math.max(rows.length, 1); index += pageSize) {
    pages.push(rows.slice(index, index + pageSize));
  }

  const objects = [
    object(1, "<< /Type /Catalog /Pages 2 0 R >>"),
    object(2, `<< /Type /Pages /Kids [${pages.map((_page, index) => `${3 + index} 0 R`).join(" ")}] /Count ${pages.length} >>`)
  ];

  const contentStartId = 3 + pages.length;
  pages.forEach((_page, index) => {
    objects.push(object(3 + index, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${contentStartId + pages.length} 0 R /F2 ${contentStartId + pages.length + 1} 0 R >> >> /Contents ${contentStartId + index} 0 R >>`));
  });

  pages.forEach((pageRows, index) => {
    const stream = pageRows.length
      ? pageCommands(pageRows, index + 1, pages.length)
      : pageCommands([{ companyName: "No hay clientes para exportar." }], index + 1, pages.length);
    objects.push(object(contentStartId + index, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`));
  });

  objects.push(
    object(contentStartId + pages.length, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    object(contentStartId + pages.length + 1, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")
  );

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
