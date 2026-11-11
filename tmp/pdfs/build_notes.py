import fitz, os, re
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from xml.sax.saxutils import escape
root=r'D:/Projects/Clients/Veterina'
out=root+'/output/pdf/Comprehensive_Foodborne_Diseases_and_Canned_Food_Notes.pdf'
files=[('Module 10: Foodborne Diseases',root+'/tmp/pdfs/module10.pdf','Slide'),('Lesson 9.2: Microbial Spoilage of Canned Food',r'C:/Users/63976/Downloads/Lesson 9.2 Microbial Spoilage of Canned Food.pdf','Page'),('Foodborne Illness Reference',r'C:/Users/63976/Downloads/foodborne_illness_ref.pdf','Page')]
w,h=595.28,841.89
cw=(w-80)/2
styles={
'h':ParagraphStyle('h',fontName='Helvetica-Bold',fontSize=14,leading=17,textColor=colors.HexColor('#14545c'),spaceAfter=10),
's':ParagraphStyle('s',fontName='Helvetica-Bold',fontSize=10,leading=13,textColor=colors.HexColor('#14545c'),spaceBefore=10,spaceAfter=6,keepWithNext=True),
'b':ParagraphStyle('b',fontName='Helvetica',fontSize=9,leading=12,spaceAfter=5),
'c':ParagraphStyle('c',fontName='Helvetica-Oblique',fontSize=7,leading=9,spaceAfter=7)}
def footer(c,d):
 c.setStrokeColor(colors.HexColor('#b5c9ca'));c.line(32,31,w-32,31)
 c.setFont('Helvetica',7);c.drawString(32,20,'FOOD MICROBIOLOGY  /  COMPLETE LESSON NOTES');c.drawRightString(w-32,20,str(d.page))
doc=BaseDocTemplate(out,pagesize=(w,h),leftMargin=32,rightMargin=32,topMargin=35,bottomMargin=40)
doc.addPageTemplates(PageTemplate(id='columns',frames=[Frame(32,40,cw,h-75,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),Frame(48+cw,40,cw,h-75,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=footer))
story=[Paragraph('Food Microbiology',styles['h']),Paragraph('Complete lesson notes',styles['h']),Paragraph('Full content from the supplied presentation and two reference documents. Read down the left column, then down the right column. Source panels preserve diagrams, tables, labels and the original wording alongside the selectable text. Repeated content is retained.',styles['b'])]
counts=[]
for section,path,label in files:
 story.append(PageBreak());story.append(Paragraph(escape(section),styles['h']))
 src=fitz.open(path);counts.append((section,len(src)))
 for i,page in enumerate(src):
  text=page.get_text(sort=True).strip()
  lines=[s.strip() for s in text.splitlines() if s.strip()]
  title=lines[0] if lines else 'Visual content'
  story.append(Paragraph(escape(f'{label} {i+1} - {title[:150]}'),styles['s']))
  for line in lines:
   line=line.replace('\u2022','- ').replace('\uf0a7','- ').replace('\uf0b7','- ').replace('\u25a0','- ').replace('\x00','')
   story.append(Paragraph(escape(line),styles['b']))
  imgpath=root+f'/tmp/pdfs/source_{len(counts)}_{i}.png'
  pix=page.get_pixmap(matrix=fitz.Matrix(1.5,1.5),alpha=False);pix.save(imgpath)
  iw=cw;ih=iw*page.rect.height/page.rect.width
  if ih>510: iw*=510/ih;ih=510
  story.append(KeepTogether([Spacer(1,4),Image(imgpath,width=iw,height=ih),Paragraph(f'Original source panel - {label.lower()} {i+1}',styles['c'])]))
doc.build(story)
check=fitz.open(out)
print(counts);print('OUTPUT',out,'PAGES',len(check))
for idx in [0,1,len(check)//2,len(check)-1]:
 check[idx].get_pixmap(matrix=fitz.Matrix(1,1)).save(root+f'/tmp/pdfs/check_{idx}.png')

