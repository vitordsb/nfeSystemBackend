
import mongoose from "mongoose";

const NotaCompraSchema = new mongoose.Schema({
  numero: { type: String, required: true, unique: true },
  chaveNFe: { type: String, required: true, unique: true }, // Chave única da NFE
  dataEmissao: String,
  remetente: {
    nome: String,
    cnpj: String,
    endereco: Object
  },
  destinatario: {
    nome: String,
    cnpj: String,
    cpf: String,
    endereco: Object
  },
  transportadora: Object,
  produtos: Array,
  valorTotal: Number,
  xmlTexto: String,
  pdfFileId: { type: mongoose.Schema.Types.ObjectId }, // Referência para o GridFS
  criadoEm: { type: Date, default: Date.now }
});

// Índices para busca (mantendo apenas os que não são 'unique: true')
NotaCompraSchema.index({ "remetente.nome": "text", "destinatario.nome": "text" });
NotaCompraSchema.index({ valorTotal: 1 });

export const NotaCompra = mongoose.model("NotaCompra", NotaCompraSchema);


