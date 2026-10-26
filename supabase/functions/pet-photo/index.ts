import { checked,createClient,headers,staff,url } from '../_shared/http.ts';
import { boundedBytes,downloadPhoto,MAX_PHOTO_BYTES,photoFormat,sha256,uploadPhoto } from '../_shared/petPhotos.ts';
import { photoConfig } from '../_shared/photoConfig.ts';
import { createPhotoByteCache } from '../_shared/photoCache.ts';

const photoBytes=createPhotoByteCache();

Deno.serve(async(req:Request)=>{
  const responseHeaders={...headers,'Cache-Control':'no-store'};
  if(req.method==='OPTIONS')return new Response(null,{headers:responseHeaders});
  let release: (()=>Promise<void>)|undefined;
  try{
    const actor=await staff(req);
    if(req.method!=='POST')throw new Error('VALIDATION_FAILED');
    const config=photoConfig();
    const multipart=req.headers.get('Content-Type')?.startsWith('multipart/form-data');
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const manage=async(data:Record<string,unknown>)=>checked(await admin.rpc('pet_photo_admin',{p_actor:actor.user.id,p_data:data}));
    if(multipart){
      const readiness=await manage({action:'capabilities'});
      if(!config||!readiness.enabled)throw new Error('PROVIDER_NOT_CONFIGURED');
      const bytes=await boundedBytes(req.body,MAX_PHOTO_BYTES+65536);
      const form=await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('Content-Type')!},body:bytes}).formData();
      const file=form.get('file');
      if(!(file instanceof File)||file.size===0)throw new Error('PHOTO_INVALID_FORMAT');
      if(file.size>MAX_PHOTO_BYTES)throw new Error('PHOTO_TOO_LARGE');
      const content=new Uint8Array(await file.arrayBuffer());
      if(!photoFormat(content))throw new Error('PHOTO_INVALID_FORMAT');
      const petId=String(form.get('petId')||''),requestId=String(form.get('requestId')||'');
      const reservation=await manage({action:'begin',petId,requestId,expectedRevision:Number(form.get('expectedRevision')),contentHash:await sha256(content)});
      if(reservation.completed)return new Response(JSON.stringify({revision:reservation.revision}),{headers:responseHeaders});
      release=async()=>{await manage({action:'failed',petId,requestId});};
      const asset=await uploadPhoto(config,new Blob([content]),reservation.publicId);
      const attached=await manage({action:'finish',petId,requestId,publicId:asset.public_id,assetId:asset.asset_id,version:asset.version,format:asset.format,bytes:asset.bytes});
      release=undefined;
      return new Response(JSON.stringify(attached),{headers:responseHeaders});
    }
    const input=JSON.parse(new TextDecoder().decode(await boundedBytes(req.body,4096)));
    if(input.action==='capabilities'){
      const readiness=await manage({action:'capabilities'});
      return new Response(JSON.stringify({enabled:Boolean(config)&&Boolean(readiness.enabled)}),{headers:responseHeaders});
    }
    if(input.action==='remove')return new Response(JSON.stringify(await manage({...input,action:'remove'})),{headers:responseHeaders});
    if(input.action==='read'){
      if(!config)throw new Error('PROVIDER_NOT_CONFIGURED');
      const photo=await manage({action:'read',petId:input.petId});
      if(!photo?.public_id)throw new Error('NOT_FOUND');
      // Authorization and the current asset reference are checked on every read,
      // before sharing cached immutable bytes among authorized staff requests.
      const key=JSON.stringify([config.cloud,photo.public_id,photo.version,photo.format]);
      const bytes=await photoBytes.get(key,()=>downloadPhoto(config,photo));
      return new Response(bytes,{headers:{...responseHeaders,'Content-Type':'application/octet-stream','X-Pet-Photo-Type':`image/${photo.format==='jpg'?'jpeg':photo.format}`,'Access-Control-Expose-Headers':'X-Pet-Photo-Type','X-Content-Type-Options':'nosniff'}});
    }
    throw new Error('VALIDATION_FAILED');
  }catch(error){
    if(release)await release().catch(()=>{});
    const message=error instanceof Error?error.message:String((error as {message?:string})?.message||'');
    const code=['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','PHOTO_TOO_LARGE','PHOTO_INVALID_FORMAT','PHOTO_CONFLICT','PHOTO_BUSY','PROVIDER_NOT_CONFIGURED','PHOTO_PROVIDER_FAILED'].find((value)=>message.includes(value))||'VALIDATION_FAILED';
    return new Response(JSON.stringify({error:code}),{status:code==='UNAUTHENTICATED'?401:code==='FORBIDDEN'?403:code==='NOT_FOUND'?404:code==='PHOTO_TOO_LARGE'?413:code==='PHOTO_CONFLICT'||code==='PHOTO_BUSY'?409:code==='PROVIDER_NOT_CONFIGURED'?503:400,headers:responseHeaders});
  }
});
