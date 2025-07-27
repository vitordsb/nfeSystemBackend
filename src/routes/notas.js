import express from "express";
import multer from "multer";
import { parseStringPromise } from "xml2js";
import { gerarPDF } from "@alexssmusica/node-pdf-nfe";
import { Nota } from "../models/Nota.js";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadRoot = path.join(__dirname, "..", "..", "uploads");
const xmlDir = path.join(uploadRoot, "xml");
const pdfDir = path.join(uploadRoot, "pdf");

for (const dir of [xmlDir, pdfDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const uploadXml = multer({ storage: multer.memoryStorage() }).array("xmls", 20);



router.post("/xml", multer({ storage: multer.memoryStorage() }).single("xml"), async (req, res, next) => {
  // redireciona p/ handler múltiplo para uniformizar
  req.files = req.file ? [req.file] : [];
  return router.handle(req, res, next);
});

// POST /api/notas/xmls - Recebe múltiplos XMLs
router.post("/xmls", uploadXml, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "Nenhum arquivo XML enviado." });
    }
    if (req.files.length > 100) {
      return res.status(400).json({ error: "Muitos arquivos XML enviados. Limite: 100." });
    }

    const resultados = [];

    for (const file of req.files) {
      const xmlText = file.buffer.toString("utf-8");
      const parsed  = await parseStringPromise(xmlText, { explicitArray: false });
      const infNFe  = parsed.nfeProc.NFe.infNFe;
      const numero  = infNFe.ide.nNF;

      // Salva XML
      const xmlName = `xml-${numero}.xml`;
      fs.writeFileSync(path.join(xmlDir, xmlName), xmlText);

      // Prepara dados da nota
      const notaData = {
        numero,
        dataEmissao: infNFe.ide.dhEmi,
        remetente: infNFe.emit,
        destinatario: infNFe.dest,
        transportadora: infNFe.transp || null,
        produtos: Array.isArray(infNFe.det) ? infNFe.det.map(d => d.prod) : [infNFe.det.prod],
        valorTotal: parseFloat(infNFe.total.ICMSTot.vNF),
        xmlTexto: xmlText,
        xmlPath: `/xmls/${xmlName}`
      };

      // Upsert no MongoDB
      let nota = await Nota.findOneAndUpdate(
        { numero },
        { $set: notaData },
        { new: true, upsert: true }
      );
      // se o numero do xml ja foi enviado antes, da um erro e diz que anota ja foi enviada

      if (nota.numero === numero) {
        return res.status(400).json({ error: `A nota ${numero} já foi enviada.` });
      }

      // Gera PDF
      const pdfStream = await gerarPDF(xmlText);
      const pdfName   = `pdf-${numero}.pdf`;
      const pdfPath   = path.join(pdfDir, pdfName);
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(pdfPath);
        pdfStream.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
      });

      nota.pdfUrl = `/pdfs/${pdfName}`;
      nota = await nota.save();

      resultados.push({ numero, status: 'ok', nota });
    }

    return res.json({ message: `${resultados.length} notas processadas.`, resultados });
  } catch (error) {
    console.error("Erro no processamento de múltiplos XML/PDF:", error);
    return res.status(500).json({ error: "Falha ao processar os XMLs enviados." });
  }
});
router.get("/", async (req, res) => {
  try {
    const filter = req.query.numero ? { numero: req.query.numero } : {};
    const notas = await Nota.find(filter).sort({ criadoEm: -1 });
    return res.json(notas);
  } catch (err) {
    console.error("Error listing notas:", err);
    return res.status(500).json({ error: "Failed to list notas." });
  }
});
router.delete("/", async (req, res) => {
  try {
    await Nota.deleteMany({});
    [xmlDir, pdfDir].forEach(dir => {
      fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
    });
    return res.json({ message: "Banco zerado e arquivos removidos." });
  } catch (error) {
    console.error("Erro ao deletar tudo:", error);
    return res.status(500).json({ error: "Falha ao deletar notas." });
  }
});
export default router;

