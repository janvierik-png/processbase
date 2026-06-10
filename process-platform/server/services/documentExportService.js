import { Document, Packer, Paragraph, TextRun } from "docx";
import PDFDocument from "pdfkit";

function processLines(process, sections = {}) {
  return [
    `Proces: ${process.name}`,
    `Stav: ${process.status}`,
    `Vlastnik: ${process.owner_user_id || "nezadany"}`,
    "",
    "Ucel procesu:",
    process.purpose || "",
    "",
    "Rizika a kontrolne body:",
    process.risks || "",
    "",
    "ISO vazby:",
    ...(sections.iso || []).map((item) => `${item.standard} ${item.clause}: ${item.evidence}`),
    "",
    "Revizie:",
    ...(sections.revisions || []).map((item) => `${item.version_label} ${item.revision_date}: ${item.change_note}`)
  ];
}

export async function buildDocx(process, sections) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: processLines(process, sections).map((line) => new Paragraph({
        children: [new TextRun(line)]
      }))
    }]
  });
  return Packer.toBuffer(doc);
}

export function buildPdf(process, sections) {
  const doc = new PDFDocument({ margin: 48 });
  const chunks = [];

  doc.on("data", (chunk) => chunks.push(chunk));
  doc.fontSize(18).text(`Procesna dokumentacia: ${process.name}`, { underline: true });
  doc.moveDown();

  for (const line of processLines(process, sections).slice(1)) {
    doc.fontSize(line.endsWith(":") ? 13 : 10).text(line || " ");
  }

  doc.end();
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
