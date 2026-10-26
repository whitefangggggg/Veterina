import type { CloudinaryConfig } from './petPhotos.ts';
export function photoConfig(): CloudinaryConfig | null {
  const cloud=Deno.env.get('CLOUDINARY_CLOUD_NAME')||'dindvoe4t',key=Deno.env.get('CLOUDINARY_API_KEY')||Deno.env.get('CLOUDINARY_API_Key'),secret=Deno.env.get('CLOUDINARY_API_SECRET'),preset=Deno.env.get('CLOUDINARY_UPLOAD_PRESET');
  if(Deno.env.get('CLOUDINARY_PHOTOS_ENABLED')==='false'||!cloud||!key||!secret||!preset) return null;
  return {cloud,key,secret,preset};
}
