# usage: seg.py model.onnx image x0 y0 x1 y1 out_prefix
# Runs a 1024x1024 salient-object model on the crop; writes crop RGB and mask (float, 0..1) as .npy/.png
import sys,numpy as np,cv2,onnxruntime as ort
from PIL import Image, ImageOps
m,img=sys.argv[1],sys.argv[2]; x0,y0,x1,y1=map(int,sys.argv[3:7]); out=sys.argv[7]
im=ImageOps.exif_transpose(Image.open(img)).convert('RGB')
a=np.asarray(im)[y0:y1,x0:x1].copy()
so=ort.SessionOptions(); so.intra_op_num_threads=8
s=ort.InferenceSession(m,so,providers=['CPUExecutionProvider'])
def run(rgb):
    x=cv2.resize(rgb,(1024,1024),interpolation=cv2.INTER_AREA).astype(np.float32)/255.
    if 'isnet' in m: x=(x-0.5)/1.0
    else: x=(x-np.array([0.485,0.456,0.406]))/np.array([0.229,0.224,0.225])
    x=x.transpose(2,0,1)[None].astype(np.float32)
    y=s.run(None,{s.get_inputs()[0].name:x})[0][0,0]
    if 'BiRefNet' in m: y=1/(1+np.exp(-y))
    else: y=(y-y.min())/(y.max()-y.min()+1e-8)
    return cv2.resize(y.astype(np.float32),(rgb.shape[1],rgb.shape[0]),interpolation=cv2.INTER_CUBIC).clip(0,1)
mask=run(a)
np.save(out+'_mask.npy',mask); Image.fromarray(a).save(out+'_rgb.png')
Image.fromarray((mask*255).astype(np.uint8)).save(out+'_mask.png')
print(a.shape)
