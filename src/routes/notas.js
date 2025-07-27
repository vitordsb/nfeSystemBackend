
// src/routes/notas.js
import express from "express";
import multer from "multer";
import { parseStringPromise } from "xml2js";
import { gerarPDF } from "@alexssmusica/node-pdf-nfe";
import { Nota } from "../models/Nota.js";
import mongoose from "mongoose";
import { GridFSBucket, ObjectId } from "mongodb";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Helper para obter o db nativo do driver a partir do mongoose
function getNativeDb() {
  const conn = mongoose.connection;
  if (!conn.db) {
    throw new Error("Mongoose ainda não conectado ao MongoDB");
  }
  return conn.db;
}

// Helper para extrair chave da NFE do XML
function extrairChaveNFe(infNFe) {
  // A chave pode estar em infNFe.$.Id ou infNFe.id
  const id = infNFe.$ ? infNFe.$.Id : infNFe.id;
  if (id && id.startsWith('NFe')) {
    return id.substring(3); // Remove 'NFe' do início
  }
  return id;
}

/**
 * POST /api/notas
 * - Recebe um XML (campo "xml")
 * - Verifica duplicidade por número da NFE e chave
 * - Faz insert da Nota no MongoDB
 * - Gera PDF e salva no GridFS
 */
router.post("/", upload.single("xml"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Arquivo XML é obrigatório." });
    }

    const xml = req.file.buffer.toString("utf-8");
    const parsedXml = await parseStringPromise(xml, { explicitArray: false });
    
    // Verifica se o XML tem a estrutura esperada
    if (!parsedXml.nfeProc || !parsedXml.nfeProc.NFe || !parsedXml.nfeProc.NFe.infNFe) {
      return res.status(400).json({ error: "XML não possui estrutura válida de NFE." });
    }

    const { nfeProc: { NFe: { infNFe } } } = parsedXml;
    const numero = infNFe.ide.nNF;
    const chaveNFe = extrairChaveNFe(infNFe);

    if (!numero || !chaveNFe) {
      return res.status(400).json({ error: "Não foi possível extrair número ou chave da NFE do XML." });
    }

    // Verifica duplicidade por número da NFE
    const notaExistentePorNumero = await Nota.findOne({ numero });
    if (notaExistentePorNumero) {
      return res.status(409).json({ 
        error: `NFE com número ${numero} já foi importada.`,
        notaExistente: {
          id: notaExistentePorNumero._id,
          numero: notaExistentePorNumero.numero,
          chaveNFe: notaExistentePorNumero.chaveNFe,
          criadoEm: notaExistentePorNumero.criadoEm
        }
      });
    }

    // Verifica duplicidade por chave da NFE
    const notaExistentePorChave = await Nota.findOne({ chaveNFe });
    if (notaExistentePorChave) {
      return res.status(409).json({ 
        error: `NFE com chave ${chaveNFe} já foi importada.`,
        notaExistente: {
          id: notaExistentePorChave._id,
          numero: notaExistentePorChave.numero,
          chaveNFe: notaExistentePorChave.chaveNFe,
          criadoEm: notaExistentePorChave.criadoEm
        }
      });
    }

    // Prepara dados da nota com estrutura melhorada
    const notaData = {
      numero,
      chaveNFe,
      dataEmissao: infNFe.ide.dhEmi,
      remetente: {
        nome: infNFe.emit.xNome,
        cnpj: infNFe.emit.CNPJ,
        endereco: {
          logradouro: infNFe.emit.enderEmit?.xLgr,
          numero: infNFe.emit.enderEmit?.nro,
          bairro: infNFe.emit.enderEmit?.xBairro,
          municipio: infNFe.emit.enderEmit?.xMun,
          uf: infNFe.emit.enderEmit?.UF,
          cep: infNFe.emit.enderEmit?.CEP
        }
      },
      destinatario: {
        nome: infNFe.dest?.xNome,
        cnpj: infNFe.dest?.CNPJ,
        cpf: infNFe.dest?.CPF,
        endereco: {
          logradouro: infNFe.dest?.enderDest?.xLgr,
          numero: infNFe.dest?.enderDest?.nro,
          bairro: infNFe.dest?.enderDest?.xBairro,
          municipio: infNFe.dest?.enderDest?.xMun,
          uf: infNFe.dest?.enderDest?.UF,
          cep: infNFe.dest?.enderDest?.CEP
        }
      },
      transportadora: infNFe.transp || null,
      produtos: Array.isArray(infNFe.det)
        ? infNFe.det.map(d => d.prod)
        : [infNFe.det.prod],
      valorTotal: parseFloat(infNFe.total.ICMSTot.vNF),
      xmlTexto: xml
    };

    // Cria a nova nota
    const nota = new Nota(notaData);
    await nota.save();

    // Gera PDF e armazena no GridFS
    const db = getNativeDb();
    const bucket = new GridFSBucket(db, { bucketName: "pdfs" });

    const pdfStream = await gerarPDF(xml);
    const uploadStream = bucket.openUploadStream(`pdf-${numero}.pdf`);
    pdfStream.pipe(uploadStream);

    // Espera o upload terminar e captura o fileId
    const fileId = await new Promise((resolve, reject) => {
      uploadStream.on("finish", () => resolve(uploadStream.id));
      uploadStream.on("error", reject);
    });

    // Salva a referência no documento Nota
    nota.pdfFileId = fileId;
    await nota.save();

    res.status(201).json({
      message: "NFE importada com sucesso!",
      nota: {
        id: nota._id,
        numero: nota.numero,
        chaveNFe: nota.chaveNFe,
        valorTotal: nota.valorTotal,
        remetente: nota.remetente.nome,
        destinatario: nota.destinatario.nome,
        criadoEm: nota.criadoEm
      }
    });
  } catch (err) {
    console.error("Erro ao processar XML/PDF:", err);
    
    // Tratamento de erros específicos
    if (err.code === 11000) {
      const campo = Object.keys(err.keyPattern)[0];
      return res.status(409).json({ 
        error: `Já existe uma NFE com este ${campo === 'numero' ? 'número' : 'chave'}.` 
      });
    }
    
    res.status(500).json({ error: "Erro interno do servidor: " + err.message });
  }
});

/**
 * GET /api/notas
 * - Lista todas as notas com busca avançada
 * - Suporte a busca por: numero, remetente, destinatario, valorTotal
 */
router.get("/", async (req, res) => {
  try {
    const { busca, numero, valorMin, valorMax, page = 1, limit = 10 } = req.query;
    let filter = {};

    // Busca por número específico
    if (numero) {
      filter.numero = numero;
    }

    // Busca textual por remetente ou destinatário
    if (busca) {
      filter.$or = [
        { "remetente.nome": { $regex: busca, $options: "i" } },
        { "destinatario.nome": { $regex: busca, $options: "i" } },
        { numero: { $regex: busca, $options: "i" } }
      ];
    }

    // Filtro por faixa de valor
    if (valorMin || valorMax) {
      filter.valorTotal = {};
      if (valorMin) filter.valorTotal.$gte = parseFloat(valorMin);
      if (valorMax) filter.valorTotal.$lte = parseFloat(valorMax);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [notas, total] = await Promise.all([
      Nota.find(filter)
        .select('numero chaveNFe dataEmissao remetente.nome destinatario.nome valorTotal criadoEm pdfFileId')
        .sort({ criadoEm: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Nota.countDocuments(filter)
    ]);

    res.json({
      notas,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    console.error("Erro ao listar notas:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/notas/:id
 * - Busca uma nota específica por ID
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const nota = await Nota.findById(id);
    if (!nota) {
      return res.status(404).json({ error: "Nota não encontrada." });
    }

    res.json(nota);
  } catch (err) {
    console.error("Erro ao buscar nota:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/notas
 * - Apaga todas as notas e limpa o bucket "pdfs" no GridFS
 */
router.delete("/", async (req, res) => {
  try {
    await Nota.deleteMany({});
    const db = getNativeDb();
    await db.collection("pdfs.files").deleteMany({});
    await db.collection("pdfs.chunks").deleteMany({});
    res.json({ message: "Todas as notas e PDFs foram apagados." });
  } catch (err) {
    console.error("Erro ao deletar tudo:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/notas/:id
 * - Apaga uma nota específica e seu PDF no GridFS
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "ID inválido." });
    }

    const nota = await Nota.findByIdAndDelete(id);
    if (!nota) {
      return res.status(404).json({ error: "Nota não encontrada." });
    }

    // Remove o PDF do GridFS se existir
    if (nota.pdfFileId) {
      const db = getNativeDb();
      const bucket = new GridFSBucket(db, { bucketName: "pdfs" });
      try {
        await bucket.delete(new ObjectId(nota.pdfFileId));
      } catch (gridError) {
        console.warn("Erro ao deletar PDF do GridFS:", gridError);
      }
    }

    res.json({ 
      message: `Nota ${nota.numero} excluída com sucesso.`,
      notaExcluida: {
        id: nota._id,
        numero: nota.numero,
        chaveNFe: nota.chaveNFe
      }
    });
  } catch (err) {
    console.error("Erro ao deletar nota:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;


