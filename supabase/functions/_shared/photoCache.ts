// This cache holds bytes only. Every caller must validate the active staff member
// and current database photo reference before looking up a cached asset version.
export function createPhotoByteCache({ ttlMs=300_000,maxBytes=16*1024*1024,maxEntries=100,now=Date.now }={}) {
  const entries=new Map<string,{bytes:Uint8Array<ArrayBuffer>;expires:number}>();
  const pending=new Map<string,Promise<Uint8Array<ArrayBuffer>>>();
  let size=0;
  const remove=(key:string)=>{const entry=entries.get(key);if(entry){size-=entry.bytes.byteLength;entries.delete(key);}};
  return { async get(key:string,load:()=>Promise<Uint8Array<ArrayBuffer>>):Promise<Uint8Array<ArrayBuffer>> {
    for(const [id,entry]of entries)if(entry.expires<=now())remove(id);
    const hit=entries.get(key);
    if(hit){entries.delete(key);entries.set(key,hit);return hit.bytes;}
    const existing=pending.get(key);if(existing)return existing;
    const promise=Promise.resolve().then(load).then(bytes=>{
      if(bytes.byteLength<=maxBytes){
        entries.set(key,{bytes,expires:now()+ttlMs});size+=bytes.byteLength;
        while(size>maxBytes||entries.size>maxEntries)remove(entries.keys().next().value!);
      }
      return bytes;
    }).finally(()=>{pending.delete(key);});
    pending.set(key,promise);return promise;
  } };
}
