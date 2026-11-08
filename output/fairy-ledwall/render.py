import imageio_ffmpeg, subprocess, random
from pathlib import Path
src=Path(r'C:/Users/63976/.codex/generated_images/01a1b401-22e6-7782-ac1a-674f1057204a/exec-bebe89d8-3e9d-472d-bdfe-7fed4d2578f9.png')
out=Path('output/fairy-ledwall/fairy-garden-loop.mp4')
f="scale=3840:2160,zoompan=z='1.02+0.02*sin(2*PI*on/600)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=600:s=1920x1080:fps=30"
random.seed(8)
for i in range(24):
 x=random.randrange(80,1840); y=random.randrange(80,1000); p=random.random()*6.28
 f+=f",drawbox=x={x}:y={y}:w=3:h=3:color=0xffefba@0.65:t=fill:enable='gt(sin(2*PI*t/5+{p}),0.6)'"
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-i',str(src),'-vf',f,'-t','20','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(out)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
print(out.resolve())
