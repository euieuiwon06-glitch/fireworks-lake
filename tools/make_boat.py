"""배 사진 → 장면과 같은 플랫 픽셀 스프라이트(assets/boat.png, 투명 배경).

사용: python tools/make_boat.py [폭(칸)=58]
- 배경(거의 단색 남색)과 색 차이로 배를 따냄, 물에 비친 부분(WATERLINE 아래)은 버림
- 칸 평균으로 줄이고, 색은 장면 바탕(assets/base.png)의 팔레트 중 가장 가까운 색으로 바꿈 → 같은 그림 스타일
- 외톨이 칸 정리(다수결)
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
WATERLINE = 233          # 원본에서 선체 바닥(이 아래는 물 반사)
BROWN = np.array([[43, 28, 34], [66, 42, 42], [92, 58, 50], [122, 80, 62], [154, 108, 82]], float)  # 밤 갈색 단계(어두움→밝음)
EDGE = 8                 # 원본 왼쪽 테두리 선 제외
BG = np.array([23, 28, 60])


def main():
    width = int(sys.argv[1]) if len(sys.argv) > 1 else 58
    im = np.asarray(Image.open(os.path.join(HERE, "boat_src.png")).convert("RGB")).astype(float)
    diff = np.abs(im - BG).sum(-1)
    m = diff > 14
    m[WATERLINE:] = False
    m[:, :EDGE] = False
    m = ndimage.binary_closing(m, np.ones((3, 3)), iterations=2)
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    sizes = ndimage.sum(m, lab, range(1, n + 1))
    keep = [i + 1 for i, s in enumerate(sizes) if s > 0.002 * m.size]
    m = np.isin(lab, keep)
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    im, m = im[y0:y1, x0:x1], m[y0:y1, x0:x1].astype(float)
    s = (x1 - x0) / width
    h = max(1, round((y1 - y0) / s))
    # 칸 평균(배 픽셀만 가중)
    rgbw = Image.fromarray((im * m[..., None]).astype(np.float32)[..., 0]).size  # dummy for shape
    acc = np.zeros((h, width, 3)); wsum = np.zeros((h, width))
    yy = np.minimum((np.arange(im.shape[0]) / s).astype(int), h - 1)
    xx = np.minimum((np.arange(im.shape[1]) / s).astype(int), width - 1)
    np.add.at(acc, (yy[:, None], xx[None, :]), im * m[..., None])
    np.add.at(wsum, (yy[:, None], xx[None, :]), m)
    cnt = np.zeros((h, width)); np.add.at(cnt, (yy[:, None], xx[None, :]), 1)
    alpha = wsum / np.maximum(cnt, 1) >= 0.5
    col = acc / np.maximum(wsum, 1e-6)[..., None]
    # 장면 팔레트로
    base = np.asarray(Image.open(os.path.join(ROOT, "assets", "base.png")).convert("RGB")).reshape(-1, 3)
    pal, pc = np.unique(base, axis=0, return_counts=True)
    pal = pal[pc > 30].astype(float)
    lum = pal @ [0.299, 0.587, 0.114]
    pal = pal[(pal[:, 2] >= pal[:, 0]) | (lum > 170)]   # 분홍빛(물가 불빛) 색은 배에 안 씀
    d = ((col[..., None, :] - pal[None, None]) ** 2).sum(-1)
    lab = d.argmin(-1)
    lab[~alpha] = -1
    # 외톨이 칸 정리
    for _ in range(2):
        p = np.pad(lab, 1, constant_values=-1)
        out = lab.copy()
        for y in range(h):
            for x in range(width):
                if lab[y, x] < 0: continue
                nb = p[y:y + 3, x:x + 3].ravel()
                nb = nb[nb >= 0]
                if (nb == lab[y, x]).sum() <= 1:
                    v, c = np.unique(nb, return_counts=True)
                    out[y, x] = v[c.argmax()]
        lab = out
    # 갈색 배: 밝기 순서는 그대로 두고 어두운~중간 색만 갈색 단계로(창·하이라이트 크림은 유지)
    cols = pal.copy()
    used = sorted({int(v) for v in np.unique(lab) if v >= 0}, key=lambda i: pal[i] @ [0.299, 0.587, 0.114])
    dark = [i for i in used if pal[i] @ [0.299, 0.587, 0.114] < 170]
    for k, i in enumerate(dark):
        cols[i] = BROWN[min(len(BROWN) - 1, round(k * (len(BROWN) - 1) / max(1, len(dark) - 1)))]
    pal = cols
    rgba = np.zeros((h, width, 4), np.uint8)
    rgba[lab >= 0, :3] = pal[lab[lab >= 0]].astype(np.uint8)
    rgba[lab >= 0, 3] = 255
    Image.fromarray(rgba).save(os.path.join(ROOT, "assets", "boat.png"))
    print("boat", width, "x", h)


if __name__ == "__main__":
    main()
