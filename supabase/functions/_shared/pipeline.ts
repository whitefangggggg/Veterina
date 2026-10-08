// Provider-neutral contracts; no default model, vendor, or dimension is assumed.
export interface Chunker { split(content:string):string[]; }
export interface Embedder { embed(content:string[]):Promise<number[][]>; }
export interface Retriever { retrieve(question:string,patientId:string|null):Promise<unknown[]>; }
export interface Generator { answer(question:string,evidence:unknown[]):Promise<string>; }
export class TextChunker implements Chunker {
  split(content:string){const result:string[]=[];for(let i=0;i<content.length;i+=1000)result.push(content.slice(i,i+1200));return result;}
}
// An approved provider gateway implements this contract. Secrets are Edge-only.
// POST {model, inputs:string[]} -> {embeddings:number[][]}.
export class GatewayEmbedder implements Embedder {
  constructor(private endpoint:string,private key:string,private model:string,private dimensions:number){}
  async embed(inputs:string[]){
    const response=await fetch(this.endpoint,{method:'POST',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,inputs}),signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Embedding provider unavailable');
    const {embeddings}=await response.json();
    if(!Array.isArray(embeddings)||embeddings.length!==inputs.length||embeddings.some((v:unknown)=>!Array.isArray(v)||v.length!==this.dimensions||v.some((x)=>typeof x!=='number'||!Number.isFinite(x))))throw new Error('Embedding dimension mismatch');
    return embeddings as number[][];
  }
}
