import pymupdf as fitz, zipfile, xml.etree.ElementTree as ET, re, os
from xml.sax.saxutils import escape
from reportlab.platypus import BaseDocTemplate,PageTemplate,Frame,Paragraph,Spacer,PageBreak,Image,KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
R='D:/Projects/Clients/Veterina'; O=R+'/output/pdf/Food_Microbiology_Complete_Notes_Green_Layout.pdf'
for name,file in [('Arial','arial.ttf'),('Arial-Bold','arialbd.ttf'),('Arial-Italic','ariali.ttf')]: pdfmetrics.registerFont(TTFont(name,'C:/Windows/Fonts/'+file))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='Arial-Bold',italic='Arial-Italic',boldItalic='Arial-Bold')
W,H=612,792; M=28; GAP=25; CW=(W-2*M-GAP)/2
base=dict(fontName='Arial',fontSize=10.3,leading=14,spaceAfter=5)
b=ParagraphStyle('body',**base)
bul=ParagraphStyle('bullet',parent=b,leftIndent=15,firstLineIndent=-10)
sub=ParagraphStyle('sub',parent=bul,leftIndent=29)
head=ParagraphStyle('head',parent=b,fontSize=11.2,leading=14,backColor=colors.HexColor('#d9ead3'),borderPadding=6,spaceBefore=14,spaceAfter=12,keepWithNext=True)
module=ParagraphStyle('module',parent=head,backColor=colors.HexColor('#b6d7a8'),fontSize=12)
bold=ParagraphStyle('bold',parent=b,fontName='Arial-Bold',spaceBefore=7,keepWithNext=True)
small=ParagraphStyle('small',parent=b,fontSize=7.4,leading=10,textColor=colors.HexColor('#666666'))
def clean(t):
 return re.sub(r'\s+',' ',t.replace('\x83','').replace('\u2011','-').replace('\u2014','-').replace('\u2013','-')).strip()
def p(t,style=b): return Paragraph(escape(clean(t)),style)
def footer(c,d):
 c.setFont('Arial',7);c.setFillColor(colors.HexColor('#666666'));c.drawString(M,17,'Food Microbiology | Complete lesson notes');c.drawRightString(W-M,17,str(d.page))
doc=BaseDocTemplate(O,pagesize=(W,H));doc.addPageTemplates(PageTemplate(id='two',frames=[Frame(M,34,CW,H-62,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),Frame(M+CW+GAP,34,CW,H-62,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=footer))
story=[];coverage=[]
z=zipfile.ZipFile('C:/Users/63976/Downloads/Module 10 Foodborne Diseases.pptx');ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
pptpdf=fitz.open(R+'/tmp/pdfs/module10.pdf')
story += [p('Module 10: Foodborne Diseases',module),p('Lesson 10.1: Investigation of Foodborne Illness',head)]
for i in range(1,30):
 r=ET.fromstring(z.read(f'ppt/slides/slide{i}.xml'))
 paras=[]
 for el in r.findall('.//a:p',ns):
  t=''.join(t.text or '' for t in el.findall('.//a:t',ns));t=clean(t)
  if t: paras.append((t,el))
 if i==21: story += [PageBreak(),p('Module 10: Foodborne Diseases',module),p('Lesson 10.2: Bacterial, Viral, Parasitic, and Chemical Foodborne Diseases',head)]
 if i not in [1,21] and paras:
  title=paras[0][0]
  if title.startswith('http'): title='Food allergy illustration'
  story.append(p(title,head));story.append(p(f'Source: Module 10, slide {i}',small))
 for j,(t,el) in enumerate(paras):
  if j==0 and i not in [1,21]: continue
  if i in [1,21] and j==0: continue
  if t.startswith('http'): story.append(p(t,small));continue
  runs=el.findall('.//a:rPr',ns); isbold=any(x.get('b')=='1' for x in runs)
  pr=el.find('a:pPr',ns);level=int(pr.get('lvl','0')) if pr is not None else 0
  if len(t)<85 and isbold: story.append(p(t,bold))
  else: story.append(p(('• ' if i not in [1,21] else '')+t,sub if level else bul if i not in [1,21] else b))
 if i in [5,27,28,29]:
  page=pptpdf[i-1]; pix=page.get_pixmap(matrix=fitz.Matrix(2,2));path=R+f'/tmp/pdfs/figure_slide{i}.png';pix.save(path)
  if not paras: story.append(p(f'Foodborne disease source material - slide {i}',head))
  story.append(Image(path,width=CW,height=CW*page.rect.height/page.rect.width))
 coverage.append(('slide',i,len(paras)))

def pdfnotes(filename,title):
 story.extend([PageBreak(),p(title,module)])
 src=fitz.open('C:/Users/63976/Downloads/'+filename)
 for i,page in enumerate(src):
  lines=[clean(t) for t in page.get_text().splitlines()];lines=[x for x in lines if x and x not in ['cvm.vsu.edu.ph','vsu.edu.ph','Return to Table of Contents']]
  if not lines: continue
  # Join wrapped lines, retaining bullet and field boundaries.
  groups=[];cur=''
  for t in lines:
   start=bool(re.match(r'^[•■§▪]|^o\s|^[a-c][.)]\s|^\d+[.)]\s|^(Pathogen|Type|Oxygen|Spore Former|Description|Incubation Period|Duration of Illness|Symptoms|Common Cause|Foods Implicated|Prevention|Type of Illness):',t))
   if start or (cur and (cur.endswith(('.',':')) or len(cur)<65 and t[0].isupper() and not cur.endswith(','))):
    if cur: groups.append(cur)
    cur=t
   else: cur=(cur+' '+t).strip()
  if cur: groups.append(cur)
  # First source line is the topic heading, not a running website header.
  first=lines[0]
  headings={1:'Microbial Spoilage of Canned Food',2:'Learning outcomes',3:'Factors Affecting Microbial Spoilage',4:'Microbial spoilage',5:'Factors determining microbial unsoundness',6:'Flat Souring',7:'Flat Souring (continued)',8:'Chemical spoilage - Hydrogen swell',9:'Hydrogen swell (continued)',10:'Judgement',11:'Sulphiding',12:'Prevention, Treatment and Judgement',13:'Rust or Damage',14:'Pin holing and self-sealing cans',15:'Common can distortions',16:'Unfilled cans and damage',17:'Judgement of damaged cans',18:'Springer and Leaker',19:'Examination of containers'}
  topic=headings.get(i+1,first) if filename.startswith('Lesson') else first
  story.append(p(topic,head));story.append(p(f'Source: {filename}, PDF page {i+1}',small))
  remaining=' '.join(groups)
  if remaining.startswith(first): remaining=remaining[len(first):].strip()
  # Use original text blocks to keep all original words while making paragraphs readable.
  first_removed=False
  for g in groups:
   if not first_removed and g.startswith(first) and topic==first: g=g[len(first):].strip();first_removed=True
   if not g or g.strip() in ['•','■','§','▪']: continue
   g=re.sub(r'^[■§▪]','• ',g)
   if re.match(r'^o\s',g): story.append(p('○ '+g[2:],sub));continue
   if g.startswith('•'): story.append(p(g,bul));continue
   field=re.match(r'^([^:]{1,26}):\s*(.*)',g)
   if field:
    story.append(Paragraph('<b>'+escape(field[1])+':</b> '+escape(field[2]),b))
   elif len(g)<70 and not g.endswith('.'): story.append(p(g,bold))
   else: story.append(p(g,b))
  # Preserve substantive embedded illustrations; omit repeated institutional logos.
  for n,img in enumerate(page.get_image_info()):
   rect=fitz.Rect(img['bbox'])
   if rect.width>page.rect.width*.35 and rect.height>page.rect.height*.22:
    path=R+f'/tmp/pdfs/pdf_figure_{len(coverage)}_{n}.png';page.get_pixmap(matrix=fitz.Matrix(2,2),clip=rect).save(path)
    story.append(Image(path,width=CW,height=min(CW*rect.height/rect.width,550)))
  coverage.append((filename,i+1,len(lines)))
pdfnotes('Lesson 9.2 Microbial Spoilage of Canned Food.pdf','Lesson 9.2: Microbial Spoilage of Canned Food')
pdfnotes('foodborne_illness_ref.pdf','Foodborne Illness: Disease Reference')

doc.build(story)
d=fitz.open(O);print('OUTPUT',O,'PAGES',len(d),'SOURCE UNITS',len(coverage))
for i in range(len(d)):
 d[i].get_pixmap(matrix=fitz.Matrix(.8,.8)).save(R+f'/tmp/pdfs/green_{i+1}.png')
