"""Offline experiment: locate neutral metal rectangles without a model hint."""
import sys, json, time
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from common import Recognizer

def crops(image):
    rgb=np.asarray(image.convert('RGB'))
    hsv=cv2.cvtColor(rgb,cv2.COLOR_RGB2HSV)
    mask=cv2.inRange(hsv,np.array([0,0,100]),np.array([179,50,255]))
    mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((5,5),np.uint8))
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours,key=cv2.contourArea,reverse=True)[:8]:
        rect=cv2.minAreaRect(contour); w,h=rect[1]
        if min(w,h)<45 or max(w,h)/min(w,h)>1.7: continue
        if not .015<w*h/(image.width*image.height)<.4: continue
        if cv2.contourArea(contour)/(w*h)<.75: continue
        box=cv2.boxPoints(rect)
        ordered=np.zeros((4,2),np.float32)
        sums=box.sum(axis=1); diffs=np.diff(box,axis=1).ravel()
        ordered[0]=box[np.argmin(sums)];ordered[2]=box[np.argmax(sums)]
        ordered[1]=box[np.argmin(diffs)];ordered[3]=box[np.argmax(diffs)]
        width=round(np.linalg.norm(ordered[1]-ordered[0]));height=round(np.linalg.norm(ordered[3]-ordered[0]))
        target=np.float32([[0,0],[width*3-1,0],[width*3-1,height*3-1],[0,height*3-1]])
        crop=cv2.warpPerspective(rgb,cv2.getPerspectiveTransform(ordered,target),(width*3,height*3),flags=cv2.INTER_CUBIC)
        yield Image.fromarray(crop),ordered.tolist()

if __name__=='__main__':
    recognizer=Recognizer()
    image=Image.open(sys.argv[1]).convert('RGB')
    for i,(crop,box) in enumerate(crops(image)):
        started=time.time(); result=recognizer.recognize(crop)
        out=Path('.cache/body-crop');out.mkdir(parents=True,exist_ok=True)
        crop.save(out/f'crop-{i}.png')
        print(json.dumps({'box':box,'accepted':result['accepted'],'model':result['model'],'reason':result['reason'],'readings':result['readings'],'elapsed':time.time()-started},ensure_ascii=False))


