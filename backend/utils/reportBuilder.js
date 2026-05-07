// backend/utils/reportBuilder.js
function buildTestReportHTML(sections, metadata) {
  const date = new Date().toLocaleDateString();
  const sectionHTML = sections.map(s => `
    <section>
      <h2>${s.title}</h2>
      <p>${s.content.replace(/\n/g, "<br>")}</p>
    </section>
  `).join("");

  return `<!DOCTYPE html>
<html>
<head>
  <title>Test Report — ${metadata.filename || "Generated Report"}</title>
  <style>
    body { font-family: system-ui; max-width: 900px; margin: 40px auto; color: #1a1a2e; }
    h1 { border-bottom: 3px solid #6366f1; padding-bottom: 12px; }
    h2 { color: #6366f1; margin-top: 32px; }
    section { margin-bottom: 24px; line-height: 1.7; }
    .meta { color: #888; font-size: 13px; margin-bottom: 32px; }
  </style>
</head>
<body>
  <h1>Test Report</h1>
  <div class="meta">
    Source: ${metadata.filename || "Uploaded Document"} | Generated: ${date} | By: Overseer RAG
  </div>
  ${sectionHTML}
</body>
</html>`;
}

module.exports = { buildTestReportHTML };
