import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_USER = process.env.MONGO_USER;
const MONGO_PASS = process.env.MONGO_PASS;
const MONGO_HOST= process.env.MONGO_HOST;

export async function connect() {
  try {
    await mongoose.connect(`mongodb+srv://${MONGO_USER}:${MONGO_PASS}@${MONGO_HOST}/?retryWrites=true&w=majority`);
    console.log("MongoDB conectado!");
  } catch (err) {
    console.error("Erro ao conectar no MongoDB:", err.message);
  }
}
