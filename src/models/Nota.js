
import mongoose from "mongoose";

const NotaSchema = new mongoose.Schema({
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

// Índices para busca
NotaSchema.index({ numero: 1 });
NotaSchema.index({ chaveNFe: 1 });
NotaSchema.index({ "remetente.nome": "text", "destinatario.nome": "text" });
NotaSchema.index({ valorTotal: 1 });

export const Nota = mongoose.model("Nota", NotaSchema);


