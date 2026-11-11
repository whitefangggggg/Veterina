import fitz,zipfile,xml.etree.ElementTree as E
z=zipfile.ZipFile(r'C:/Users/63976/Downloads/Module 10 Foodborne Diseases.pptx');ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
for i in range(1,30):
 r=E.fromstring(z.read(f'ppt/slides/slide{i}.xml'));ps=[''.join(p.itertext()) for p in []];ps=[''.join(t.text or '' for t in p.findall('.//a:t',ns)) for p in r.findall('.//a:p',ns)];print(i,repr(ps))
for f in ['Lesson 9.2 Microbial Spoilage of Canned Food.pdf','foodborne_illness_ref.pdf']:
 d=fitz.open('C:/Users/63976/Downloads/'+f)
 print('\nFILE',f)
 for i,p in enumerate(d): print(i+1,repr(p.get_text()[:800]))
