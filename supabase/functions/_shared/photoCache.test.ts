import { describe, expect, it, vi } from 'vitest'
import { createPhotoByteCache } from './photoCache'

describe('authorized photo byte cache', () => {
  it('coalesces concurrent loads and reuses immutable asset versions', async () => {
    const cache=createPhotoByteCache(),load=vi.fn(async()=>new Uint8Array([1,2,3]));
    const [one,two]=await Promise.all([cache.get('asset:v1',load),cache.get('asset:v1',load)]);
    expect(one).toBe(two);expect(await cache.get('asset:v1',load)).toBe(one);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get('asset:v2',load);expect(load).toHaveBeenCalledTimes(2);
  });
  it('expires cached bytes, evicts LRU entries, and retries failed fetches', async () => {
    let time=0;
    const cache=createPhotoByteCache({ttlMs:100,maxBytes:4,now:()=>time});
    const load=vi.fn(async()=>new Uint8Array([1,2,3]));
    await cache.get('a',load);await cache.get('b',load);await cache.get('a',load);
    expect(load).toHaveBeenCalledTimes(3);
    time=101;await cache.get('a',load);expect(load).toHaveBeenCalledTimes(4);
    await expect(cache.get('fail',async()=>{throw Error('offline');})).rejects.toThrow('offline');
    await cache.get('fail',load);expect(load).toHaveBeenCalledTimes(5);
  });
});
