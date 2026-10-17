import {afterEach,describe,expect,it,vi} from 'vitest'
import {GatewayEmbedder,TextChunker} from './pipeline'
afterEach(()=>vi.unstubAllGlobals())
describe('Provider boundary',()=>{
  it('retains source text across overlapping chunks',()=>{
    const text='a'.repeat(999)+'boundary'+'b'.repeat(1500)
    const chunks=new TextChunker().split(text)
    expect(chunks[0]).toContain('boundary')
    expect(chunks[1]).toContain('oundary')
    expect(chunks.join('')).toContain('b'.repeat(500))
  })
  it('rejects a provider returning the wrong vector dimensions',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({embeddings:[[1,2]]}))))
    await expect(new GatewayEmbedder('https://provider.invalid','test','approved-model',3).embed(['test'])).rejects.toThrow('Embedding dimension mismatch')
  })
  it('rejects nonfinite or missing vectors',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({embeddings:[[1,null,3]]}))))
    await expect(new GatewayEmbedder('https://provider.invalid','test','model',3).embed(['text'])).rejects.toThrow('Embedding dimension mismatch')
  })
  it('sends the configured model and retains input ordering',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({embeddings:[[1,2,3],[4,5,6]]})))
    vi.stubGlobal('fetch',fetcher)
    const result=await new GatewayEmbedder('https://provider.invalid','test-key','approved-model',3).embed(['first','second'])
    expect(result).toEqual([[1,2,3],[4,5,6]])
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({model:'approved-model',inputs:['first','second']})
  })
})
