
// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import notasRouter from "./src/routes/notas.js";
import { GridFSBucket, ObjectId } from "mongodb";
import { Nota } from "./src/models/Nota.js";

dotenv.config();

const {
  MONGO_USER,
  MONGO_PASS,
  MONGO_HOST,
  PORT = 3001
} = process.env;

async function main() {
  const app = express();
  
  // Configuração de CORS para permitir acesso do frontend
  app.use(cors({
    origin: true, // Permite qualquer origem
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));
  
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Middleware para log de requisições
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // Monta o router de notas em /api/notas
  app.use("/api/notas", notasRouter);

  // Rota de health check
  app.get("/api/health", (req, res) => {
    res.json({ 
      status: "OK", 
      timestamp: new Date().toISOString(),
      mongodb: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
    });
  });

  // Rota raiz para verificar se o servidor está funcionando
  app.get("/", (req, res) => {
    res.json({ 
      message: "Sistema NFE Backend está funcionando!",
      timestamp: new Date().toISOString(),
      version: "1.0.0"
    });
  });

  // Conecta no MongoDB via Mongoose
  try {
    await mongoose.connect(
      `mongodb+srv://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/?retryWrites=true&w=majority`
    );
    console.log("MongoDB conectado!");
  } catch (error) {
    console.error("Erro ao conectar no MongoDB:", error);
    // Não encerra o processo, permite que o servidor continue rodando
  }

  // Inicializa o GridFSBucket e rotas relacionadas ao PDF
  let bucket;
  if (mongoose.connection.readyState === 1) {
    const db = mongoose.connection.db;
    bucket = new GridFSBucket(db, { bucketName: "pdfs" });
  }

  // Rota para visualizar o PDF de uma nota pelo seu _id (inline no navegador)
  app.get("/api/notas/:id/pdf", async (req, res) => {
    try {
      if (!bucket) {
        return res.status(503).json({ error: "Banco de dados não conectado." });
      }

      const { id } = req.params;
      const { download } = req.query; // ?download=true para forçar download
      
      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ error: "ID inválido." });
      }

      const nota = await Nota.findById(id);
      if (!nota || !nota.pdfFileId) {
        return res.status(404).json({ error: "PDF não encontrado para esta nota." });
      }

      // Configuração dos headers para visualização online ou download
      res.setHeader("Content-Type", "application/pdf");
      
      if (download === 'true') {
        res.setHeader("Content-Disposition", `attachment; filename="NFE-${nota.numero}.pdf"`);
      } else {
        res.setHeader("Content-Disposition", `inline; filename="NFE-${nota.numero}.pdf"`);
      }
      
      // Headers para cache e segurança
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");

      const downloadStream = bucket.openDownloadStream(
        new ObjectId(nota.pdfFileId)
      );

      // Tratamento de erros do stream
      downloadStream.on('error', (error) => {
        console.error("Erro ao fazer stream do PDF:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Erro ao carregar PDF." });
        }
      });

      downloadStream.pipe(res);
    } catch (err) {
      console.error("Erro ao buscar PDF:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    }
  });

  // Rota para gerar PDF online (sem salvar no banco)
  app.post("/api/notas/preview-pdf", express.raw({ type: 'application/xml', limit: '50mb' }), async (req, res) => {
    try {
      const xml = req.body.toString('utf-8');
      
      if (!xml) {
        return res.status(400).json({ error: "XML é obrigatório." });
      }

      // Importa dinamicamente a biblioteca de geração de PDF
      const { gerarPDF } = await import("@alexssmusica/node-pdf-nfe");
      const pdfStream = await gerarPDF(xml);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline; filename=\"preview-nfe.pdf\"");
      res.setHeader("Cache-Control", "no-cache");

      pdfStream.pipe(res);
    } catch (err) {
      console.error("Erro ao gerar preview do PDF:", err);
      res.status(500).json({ error: "Erro ao gerar preview: " + err.message });
    }
  });

  // Middleware para tratamento de erros 404
  app.use((req, res) => {
    res.status(404).json({ error: "Rota não encontrada." });
  });

  // Middleware para tratamento de erros globais
  app.use((err, req, res, next) => {
    console.error("Erro não tratado:", err);
    res.status(500).json({ error: "Erro interno do servidor." });
  });

  // IMPORTANTE: Inicia o servidor IMEDIATAMENTE, não espera o MongoDB
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://0.0.0.0:${PORT}`);
    console.log(`Health check disponível em http://0.0.0.0:${PORT}/api/health`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Tratamento de erros de conexão do MongoDB (não afeta o servidor)
  mongoose.connection.on('error', (err) => {
    console.error('Erro de conexão MongoDB:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('MongoDB desconectado');
  });

  mongoose.connection.on('connected', () => {
    console.log('MongoDB reconectado');
    // Reinicializa o bucket quando reconectar
    if (mongoose.connection.readyState === 1) {
      const db = mongoose.connection.db;
      bucket = new GridFSBucket(db, { bucketName: "pdfs" });
    }
  });

  // Tratamento de sinais para encerramento gracioso
  process.on('SIGINT', async () => {
    console.log('Recebido SIGINT. Encerrando servidor graciosamente...');
    server.close(() => {
      console.log('Servidor HTTP fechado.');
      mongoose.connection.close(() => {
        console.log('Conexão MongoDB fechada.');
        process.exit(0);
      });
    });
  });

  process.on('SIGTERM', async () => {
    console.log('Recebido SIGTERM. Encerrando servidor graciosamente...');
    server.close(() => {
      console.log('Servidor HTTP fechado.');
      mongoose.connection.close(() => {
        console.log('Conexão MongoDB fechada.');
        process.exit(0);
      });
    });
  });
}

main().catch((err) => {
  console.error("Erro ao iniciar o servidor:", err);
  process.exit(1);
});


