import { checked,createClient,json,url } from '../_shared/http.ts';
import { destroyPhoto,downloadPhoto,PhotoProviderFailure,providerFailure,uploadPhoto } from '../_shared/petPhotos.ts';
import { photoConfig } from '../_shared/photoConfig.ts';
import { createPhotoByteCache } from '../_shared/photoCache.ts';
Deno.serve(async(req:Request)=>{
  try{
    if(req.method!=='POST')return json({error:'VALIDATION_FAILED'},405);
    const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const verified=checked(await admin.rpc('verify_worker_secret',{p_secret:req.headers.get('x-worker-secret')||''}));
    if(!verified)return json({error:'FORBIDDEN'},403);
    const config=photoConfig();
    if(!config)return json({error:'PROVIDER_NOT_CONFIGURED',missingSettings:[
      ...(!(Deno.env.get('CLOUDINARY_API_KEY')||Deno.env.get('CLOUDINARY_API_Key'))?['CLOUDINARY_API_KEY']:[]),
      ...(!Deno.env.get('CLOUDINARY_API_SECRET')?['CLOUDINARY_API_SECRET']:[]),
      ...(!Deno.env.get('CLOUDINARY_UPLOAD_PRESET')?['CLOUDINARY_UPLOAD_PRESET']:[]),
    ],disabled:Deno.env.get('CLOUDINARY_PHOTOS_ENABLED')==='false'},503);
    const manage=async(data:Record<string,unknown>)=>checked(await admin.rpc('pet_photo_admin',{p_actor:null,p_data:data}));
    const input=await req.json().catch(()=>({}));
    if(input.action==='diagnose'){
      const authorization=`Basic ${btoa(`${config.key}:${config.secret}`)}`;
      const ping=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/ping`,{headers:{Authorization:authorization},signal:AbortSignal.timeout(15000)});
      const preset=await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloud)}/upload_presets/${encodeURIComponent(config.preset)}`,{headers:{Authorization:authorization},signal:AbortSignal.timeout(15000)});
      const settings=preset.ok?await preset.json():null;
      return json({cloudNameValid:/^[a-z0-9_-]+$/.test(config.cloud),apiKeyValid:/^\d+$/.test(config.key),settingsTrimmed:[config.cloud,config.key,config.secret,config.preset].every(value=>value===value.trim()),pingStatus:ping.status,presetStatus:preset.status,...(settings?{unsignedPreset:settings.unsigned,deliveryType:settings.settings?.type||null}:{presetReason:(await providerFailure(preset)).reason})});
    }
    if(input.action==='verify'){
      const publicId=`veterina/pet-photos/probe-${crypto.randomUUID()}`;
      await manage({action:'cleanup_enqueue',publicId});
      let stage='upload',cleaned=false;
      try{
        const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOwyQsAAAHkAPuSlTETAAAAAElFTkSuQmCC'),(character)=>character.charCodeAt(0));
        const asset=await uploadPhoto(config,new Blob([png],{type:'image/png'}),publicId);
        stage='authenticated_read';
        const cache=createPhotoByteCache();let providerReads=0;
        const load=()=>{providerReads++;return downloadPhoto(config,asset);};
        const firstStart=performance.now();
        const first=await cache.get(publicId,load),firstReadMs=Math.round(performance.now()-firstStart);
        const cachedStart=performance.now();
        const cached=await cache.get(publicId,load),cachedReadMs=Math.round(performance.now()-cachedStart);
        if(cached!==first||providerReads!==1)throw new Error('PHOTO_PROVIDER_FAILED');
        stage='unsigned_read';
        const unsigned=await fetch(`https://res.cloudinary.com/${encodeURIComponent(config.cloud)}/image/authenticated/${publicId}.${asset.format}`,{signal:AbortSignal.timeout(15000)});
        if(![401,403,404].includes(unsigned.status))throw new Error('PHOTO_PROVIDER_FAILED');
        stage='delete';
        await destroyPhoto(config,publicId);
        await manage({action:'cleanup_done',publicId});
        cleaned=true;
        await manage({action:'provider_ready',enabled:true});
        return json({verified:true,privateUpload:true,authenticatedRead:true,unsignedReadDenied:true,deletion:true,format:asset.format,bytes:asset.bytes,cache:{providerReads,firstReadMs,cachedReadMs}});
      }catch(error){
        await manage({action:'provider_ready',enabled:false});
        return json({verified:false,error:'PHOTO_PROVIDER_FAILED',stage,...(error instanceof PhotoProviderFailure?{reason:error.reason,providerStatus:error.status}:{})},503);
      }finally{
        if(!cleaned)try{await destroyPhoto(config,publicId);await manage({action:'cleanup_done',publicId});}catch{/* Hourly cleanup retries. */}
      }
    }
    const jobs=await manage({action:'cleanup_claim'});let removed=0;
    for(const publicId of jobs){
      try{await destroyPhoto(config,publicId);await manage({action:'cleanup_done',publicId});removed++;}
      catch{await manage({action:'cleanup_failed',publicId});}
    }
    return json({processed:jobs.length,removed});
  }catch{return json({error:'REQUEST_FAILED'},400);}
});
