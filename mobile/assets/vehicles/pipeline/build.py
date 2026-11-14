# build.py <car> <workdir> <outdir>
# Builds a transparent side-profile PNG from a crop (<prefix>_rgb.png) and BiRefNet mask (<prefix>_mask.npy).
import json, numpy as np, cv2
from PIL import Image

car, wd, od = sys.argv[1], sys.argv[2], sys.argv[3]

# ---------------------------------------------------------------- per-car config (crop coordinates)
CFG = {
 'rr': dict(prefix='rr10', mirror=True, target_w=1760,
    # body-bottom cut line: model alpha below this polyline is removed (tires come from wheel hulls)
    ycut=[(0,1045),(515,1045),(520,1102),(3040,1102),(3045,1125),(99999,1125)],
    # wheels: cx, cy, r_left, r_right, r_bottom, rim_r
    wheels=[(768,1041.5,251,257,242,186),(2784.5,1040.5,259,263,238,186)],
    ),
 'fer': dict(prefix='fer', mirror=False, target_w=1780,
    shield_box=(1245,640,1375,800),
    glass=[(1090,505),(1500,290),(1950,185),(2600,185),(2645,300),(2625,430),(2500,560),(2000,588),(1845,545),(1515,545),(1300,555),(1100,560)],
    ycut=[(0,1335),(640,1335),(645,1310),(3405,1310),(3410,1300),(4165,1300),(4170,1230),(99999,1230)],
    wheels=[(978,1133,351,373,318,232),(3770,1090,360,392,345,265)],
    ),
 'x7': dict(prefix='x7', mirror=False, target_w=1760,
    ycut=[(0,1570),(458,1570),(462,1525),(3140,1525),(3142,1565),(99999,1565)],
    wheels=[(798.5,1397.5,337,354,334,262),(3574.5,1424.5,347,352,343,270)],
    ),
}[car]

rgb = np.asarray(Image.open(f"{wd}/{CFG['prefix']}_rgb.png")).astype(np.float32)/255.
alpha = np.load(f"{wd}/{CFG['prefix']}_mask.npy").astype(np.float32)
H, W = alpha.shape
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
log = []

def s2l(c): return np.where(c<=0.04045, c/12.92, ((c+0.055)/1.055)**2.4)
def l2s(c): c=np.clip(c,0,1); return np.where(c<=0.0031308, c*12.92, 1.055*c**(1/2.4)-0.055)
def poly_mask(pts, feather=2.0):
    m = np.zeros((H,W),np.uint8); cv2.fillPoly(m,[np.int32(pts)],255)
    m = m.astype(np.float32)/255.
    return cv2.GaussianBlur(m,(0,0),feather) if feather>0 else m
def disk(cx,cy,r,soft=1.5):
    d = np.hypot(xx-cx, yy-cy); return np.clip((r-d)/soft+0.5,0,1)
def hsv():
    h = cv2.cvtColor((np.clip(rgb,0,1)*255).astype(np.uint8), cv2.COLOR_RGB2HSV_FULL).astype(np.float32)
    return h[...,0]*360/256., h[...,1]/255., h[...,2]/255.

# ---------------------------------------------------------------- 1. ground / shadow cut
xs, ys = zip(*CFG['ycut']); ycut = np.interp(np.arange(W), xs, ys).astype(np.float32)
keep = np.clip(ycut[None,:] - yy + 0.5, 0, 1)
alpha = alpha*keep
log.append('removed everything below the body-bottom line (floor, ground shadow, cables) except the tires')

# ---------------------------------------------------------------- 2. wheel hulls (solid tires, fill spoke holes, clean contact)
hull_all = np.zeros_like(alpha)
for (cx,cy,rl,rr,rb,rim) in CFG['wheels']:
    dx = xx-cx; dy = yy-cy
    rx = np.where(dx>0, rr, rl); ry = np.where(dy>0, rb, max(rl,rr))
    rho = np.sqrt((dx/rx)**2 + (dy/ry)**2)
    reff = np.minimum(rx, ry)
    hull = np.clip((1-rho)*reff + 0.5, 0, 1)
    hull_all = np.maximum(hull_all, hull)
alpha = np.maximum(alpha, hull_all)

# ---------------------------------------------------------------- 3. fill enclosed holes, drop islands
b = (alpha>0.5).astype(np.uint8)
inv = 1-b; n, lab = cv2.connectedComponents(inv, connectivity=4)
border = set(np.unique(np.r_[lab[0],lab[-1],lab[:,0],lab[:,-1]]))
holes = np.isin(lab, [i for i in range(1,n) if i not in border])
if holes.any(): log.append(f'filled {int(holes.sum())} px of enclosed mask holes'); alpha[holes]=1
b = (alpha>0.004).astype(np.uint8)
n, lab, st, _ = cv2.connectedComponentsWithStats(b, connectivity=8)
big = 1+np.argmax(st[1:,cv2.CC_STAT_AREA])
alpha[(lab!=big)] = 0

# ---------------------------------------------------------------- 4. colour work
H_, S_, V_ = hsv()
if car=='fer':
    # Rosso -> Bianco Avus. paint weight: red hue, saturated.
    hd = np.minimum(np.abs(H_-0), np.abs(H_-360))         # distance to red hue
    hd = np.where(H_>180, 360-H_, H_)
    w = np.clip((35-hd)/10,0,1) * np.clip((S_-0.06)/0.08,0,1) * np.clip((V_-0.012)/0.03,0,1)
    # exclude wheels and side glass
    for (cx,cy,rl,rr,rb,rim) in CFG['wheels']: w *= 1-disk(cx,cy,min(rl,rr,rb)-2,2)
    pass  # (no glass exclusion: interior seen through glass is dark and maps to dark grey)
    # protect the Scuderia shield badge (yellow field + tricolore + horse): hull of yellow pixels, dilated
    bx0,by0,bx1,by1 = CFG['shield_box']
    yel = (((H_>35)&(H_<75)&(S_>0.35))[by0:by1,bx0:bx1]).astype(np.uint8)
    pts = cv2.findNonZero(yel); hull = cv2.convexHull(pts)
    sh = np.zeros_like(yel); cv2.fillPoly(sh,[hull],1)
    sh = cv2.dilate(sh, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
    w[by0:by1,bx0:bx1] *= 1-sh
    w = cv2.GaussianBlur(w,(0,0),0.8)
    lin = s2l(rgb); m = np.minimum(lin[...,1], lin[...,2])
    diffuse = np.clip(lin[...,0]-m, 0, None)
    K = 1.5
    white = np.array([1.0, 0.995, 0.975], np.float32)   # Bianco Avus: neutral, very slightly warm solid white
    new = (diffuse*K)[...,None]*white + m[...,None]
    new = l2s(new)
    rgb = rgb*(1-w[...,None]) + new*w[...,None]
    log.append(f'recoloured red body paint to white (Bianco Avus target): linear-light diffuse shading = R-min(G,B) scaled x{K}, specular/reflection component min(G,B) preserved; badge, calipers, lights, glass, tyres, carbon trim untouched')

if car=='x7':
    # neutralise the blue cast of the dark (sapphire/carbon) paint -> black; keep badges/calipers
    w = np.clip((S_-0.05)/0.1,0,1) * ((H_>170)&(H_<270)).astype(np.float32) * np.clip((0.75-V_)/0.2,0,1)
    prot = np.zeros_like(w)
    for (cx,cy,rl,rr,rb,rim) in CFG['wheels']: prot = np.maximum(prot, disk(cx,cy,rim+4,3))
    prot[930:990, 1250:1355] = 1     # M badge
    w = w*(1-prot)
    g = (rgb @ np.array([0.2126,0.7152,0.0722],np.float32))[...,None]
    rgb = rgb*(1-0.75*w[...,None]) + g*0.75*w[...,None]
    log.append('reduced blue saturation of the dark-blue/black body paint by 75% (neutral black); M badge, wheel area untouched')

if car=='rr':
    # tint see-through side glass (privacy glass); vent blade + badge to dark; tyre lettering softened
    win = np.maximum(poly_mask([(905,222),(1503,222),(1503,488),(905,488)],2.5),
                     poly_mask([(1545,218),(1880,218),(2088,398),(2010,420),(2002,490),(1545,490)],2.5))
    rgb = rgb*(1-win[...,None]) + (rgb*0.28)*win[...,None]
    vent = poly_mask([(2205,560),(2355,560),(2355,935),(2205,935)],1.0)
    L = rgb.mean(2)
    vw = vent*np.clip((L-0.18)/0.12,0,1)
    vw = cv2.GaussianBlur(vw,(0,0),1.0)
    rgb = rgb*(1-vw[...,None]) + (rgb*0.16)*vw[...,None]
    log.append('darkened the see-through side door glass to privacy-tint level (x0.28), hiding showroom background/stickers seen through the windows')
    log.append('darkened the satin-silver side vent blade and its "Autobiography" script to gloss-black level (x0.16)')

if car in ('rr','x7'):
    for (cx,cy,rl,rr,rb,rim) in CFG['wheels']:
        d = disk(cx,cy,rim+3,2.0)
        H_, S_, V_ = hsv()
        sat_protect = np.clip((S_-0.25)/0.15,0,1)     # calipers / roundel colours
        if car=='x7': sat_protect = np.maximum(sat_protect, disk(cx,cy,32,2))
        wd_ = d*(1-sat_protect)
        lin = s2l(rgb); lin_dark = lin*0.13
        rgb = rgb*(1-wd_[...,None]) + l2s(lin_dark)*wd_[...,None]
        if car=='rr':
            # soften raised sidewall lettering (avoid mirrored text) in tyre annulus
            ann = np.clip(disk(cx,cy,min(rl,rr,rb)-4,3) - disk(cx,cy,rim+6,3), 0, 1)
            bl = cv2.GaussianBlur(rgb,(0,0),5)
            rgb = rgb*(1-0.8*ann[...,None]) + bl*0.8*ann[...,None]
    log.append('darkened wheel faces (machined/silver alloy) to dark gunmetal/black: linear-light x0.13 inside the rim circle, saturated parts (calipers, centre roundel) kept')
    if car=='rr': log.append('softened (blurred) the raised tyre-sidewall lettering so mirrored text is not readable')

rgb = np.clip(rgb,0,1)

# ---------------------------------------------------------------- 5. edge colour decontamination
def propagate(img, w, sigmas=(1,2,4,8,16,32,64)):
    done = w>0.5; out = np.where(done[...,None], img, 0).astype(np.float32)
    for s in sigmas:
        num = cv2.GaussianBlur(img*w[...,None],(0,0),s); den = cv2.GaussianBlur(w,(0,0),s)
        take = (~done)&(den>0.01)
        out[take] = (num/np.maximum(den,1e-6)[...,None])[take]; done |= take
    return out
fg_w = (alpha>=0.98).astype(np.float32); bg_w = (alpha<=0.02).astype(np.float32)
F_est = propagate(rgb, fg_w); B_est = propagate(rgb, bg_w)
a3 = alpha[...,None]
F_cf = np.clip((rgb - (1-a3)*B_est)/np.maximum(a3,1e-3), 0, 1)
t = np.clip((alpha-0.3)/0.6,0,1)[...,None]
F = F_est*(1-t) + F_cf*t
edge = ((alpha>0.0)&(alpha<0.98))[...,None]
rgb = np.where(edge, F, rgb)
log.append('edge decontamination: semi-transparent edge pixels re-estimated as foreground colour (closed-form unmix against propagated background, blended to propagated interior colour at low alpha)')

# ---------------------------------------------------------------- 6. level the tyre contact points (rotation)
cts = [(cx, cy+rb) for (cx,cy,rl,rr,rb,rim) in CFG['wheels']]
ang = np.degrees(np.arctan2(cts[1][1]-cts[0][1], cts[1][0]-cts[0][0]))
ctr = ((cts[0][0]+cts[1][0])/2, (cts[0][1]+cts[1][1])/2)
M = cv2.getRotationMatrix2D(ctr, ang, 1.0)
prem = np.dstack([rgb*a3, alpha])
prem = cv2.warpAffine(prem, M, (W,H), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
prem = np.clip(prem,0,1)
cts = [tuple(M @ np.array([x,y,1.0])) for x,y in cts]
log.append(f'rotated {ang:+.2f} deg about the wheelbase midpoint so both tyre contact points sit on one horizontal line')

# ---------------------------------------------------------------- 7. mirror
if CFG['mirror']:
    prem = prem[:, ::-1].copy(); cts = [(W-1-x, y) for x,y in cts]
    log.append('mirrored horizontally so the car faces left')

# ---------------------------------------------------------------- 8. crop, scale, clean, crop
def bbox(a, thr=0):
    ys_, xs_ = np.where(a>thr); return xs_.min(), ys_.min(), xs_.max()+1, ys_.max()+1
A = prem[...,3]; contact_y = max(c[1] for c in cts)
A[int(np.ceil(contact_y))+1:, :] = 0     # nothing below contact line
prem[...,3] = A; prem[...,:3] *= (A>0)[...,None]
x0,y0,x1,y1 = bbox(A, 0.5/255)
prem = prem[y0:y1, x0:x1]; cts = [(x-x0, y-y0) for x,y in cts]
sc = CFG['target_w']/prem.shape[1]
nw, nh = CFG['target_w'], int(round(prem.shape[0]*sc))
prem = cv2.resize(prem, (nw,nh), interpolation=cv2.INTER_AREA if sc<1 else cv2.INTER_CUBIC)
cts = [((x+0.5)*sc-0.5, (y+0.5)*sc-0.5) for x,y in cts]
A = np.clip(prem[...,3],0,1)
A[A<3/255.] = 0
x0,y0,x1,y1 = bbox(A, 0)
prem = prem[y0:y1, x0:x1]; A = A[y0:y1, x0:x1]; cts = [(x-x0, y-y0) for x,y in cts]
col = np.clip(prem[...,:3]/np.maximum(A,1e-6)[...,None], 0, 1)*(A>0)[...,None]
out = np.dstack([col, A])
out8 = np.round(out*255).astype(np.uint8)
Image.fromarray(out8, 'RGBA').save(f"{od}/{car}.png", optimize=True)
log.append(f'cropped to alpha bounding box and resampled (premultiplied, INTER_AREA) by x{sc:.4f} to {out8.shape[1]}x{out8.shape[0]}; alpha < 3/255 zeroed')
meta = dict(car=car, size=[out8.shape[1], out8.shape[0]], scale=sc, rotation_deg=ang, mirrored=CFG['mirror'],
            contacts=[dict(x=round(x,1), y=round(y,1)) for x,y in cts], edits=log)
json.dump(meta, open(f"{od}/{car}.json",'w'), indent=1)
print(json.dumps(meta, indent=1))
