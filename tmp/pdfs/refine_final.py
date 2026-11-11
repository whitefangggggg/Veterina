p='tmp/pdfs/revise_notes.py';s=open(p,encoding='utf-8').read();s=s.replace("if not g: continue","if not g or g.strip() in ['•','■','§','▪']: continue")
a=s.index("story.extend([Spacer(1,8),p('Source note'");e=s.index('\ndoc.build(story)',a);s=s[:a]+s[e:];open(p,'w',encoding='utf-8').write(s)
