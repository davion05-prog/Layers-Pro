import type { NextRequest } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import { reportData, reports } from "../../../lib/reports";
import { authenticated, fail, withReferences } from "../../../lib/server";

export async function GET(req: NextRequest) {
  const params = z.object({ report: z.enum(reports), farm: z.string().optional(), flock: z.string().optional(), start: z.iso.date(), end: z.iso.date() })
    .safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success || params.data.start > params.data.end) return fail("Select a valid report and period");
  const auth = await authenticated();
  if (!auth) return fail("Sign in to generate a PDF", 401);
  const { data, error } = await auth.client.rpc("layer_snapshot");
  if (error) return fail(error.message, 403);
  const { rows, references } = withReferences(data);
  const { report, ...filters } = params.data;
  const lines = reportData(rows, report, filters, references);
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const header = lines.shift()!;
  const width = 842;
  const height = 595;
  const column = (width - 76) / header.length;
  const printable = (value: string | number) => String(value).normalize("NFKD").replace(/[^\x20-\x7e]/g, "");
  let page = pdf.addPage([width, height]);
  let y = 0;
  const drawRow = (row: (string | number)[], heading = false) => {
    row.forEach((value, i) => {
      const font = heading ? bold : regular;
      let text = printable(value);
      while (text.length && font.widthOfTextAtSize(text, 9) > column - 9) text = text.slice(0, -1);
      page.drawText(text, { x: 38 + i * column, y, size: 9, font });
    });
    y -= 17;
  };
  const drawHeader = () => {
    page.drawText("Layers Pro / " + report, { x: 38, y: 550, size: 20, font: bold, color: rgb(0.10, 0.28, 0.20) });
    page.drawText(filters.start + " to " + filters.end, { x: 38, y: 528, size: 11, font: regular });
    y = 497;
    drawRow(header, true);
  };
  drawHeader();
  for (const row of lines) {
    if (y < 40) { page = pdf.addPage([width, height]); drawHeader(); }
    drawRow(row);
  }
  const bytes = new Uint8Array(await pdf.save());
  return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="layers-pro-report.pdf"', "Cache-Control": "private, no-store" } });
}
