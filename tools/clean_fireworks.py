"""원본(분홍 불꽃 그림)에서 불꽃과 물 반사를 지워 '산과 물가만' 남긴 이미지.

사용: python clean_fireworks.py 원본.png 출력.png [마스크확인.png]
지우는 것
- 분홍 계열 픽셀 전부(하늘 불꽃 + 물 반사). 물가 마을 불빛 줄(y 895~935)은 남김
- 흰 불꽃 획: 흰 불꽃이 있는 상자 안에서, 밝고 주변 바탕이 어두운 가는 획(산 능선 위쪽만)
- 불꽃 중심 밝은 덩어리(좌표 고정 원)
- 물 오른쪽 아래 흰 불꽃 반사
채우기: 같은 가로줄에서 가까운 '안 지운' 픽셀 무늬를 이어 붙임(하늘은 어두운 픽셀만 출처로) → 디더 결·세로 그라데이션 유지
"""
import sys
import cv2
import numpy as np

CORES = [(763, 178), (779, 203), (286, 343), (942, 454), (418, 488), (814, 531)]
WHITE_BOXES = [(560, 0, 970, 430), (290, 360, 570, 640), (740, 470, 1010, 690)]
# 능선 조건 없이 지우는 작은 상자(남은 흰 불꽃 부스러기)
SPECK_BOXES = [(890, 595, 1070, 690), (140, 455, 190, 505)]  # x0,y0,x1,y1
WATER_Y = 935


def ridge(x):  # 산 능선 근사(봉우리 640,540)
    return np.where(x < 640, 540 + (640 - x) * 0.34, 540 + (x - 640) * 0.33)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    bgr = cv2.imread(src)
    H, W = bgr.shape[:2]
    b, g, r = [bgr[..., i].astype(int) for i in range(3)]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    yy, xx = np.mgrid[0:H, 0:W]

    pink = (r - g > 40) & (r > b + 10) & ~((yy >= 895) & (yy < WATER_Y))
    open_l = cv2.morphologyEx(lum.astype(np.uint8), cv2.MORPH_OPEN,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    inbox = np.zeros((H, W), bool)
    for x0, y0, x1, y1 in WHITE_BOXES:
        inbox[y0:y1, x0:x1] = True
    above = yy < ridge(xx) - 6
    white = inbox & above & (lum > 140) & (open_l < 95)
    for x0, y0, x1, y1 in SPECK_BOXES:
        sb = np.zeros((H, W), bool); sb[y0:y1, x0:x1] = True
        white |= sb & (lum > 140) & (open_l < 95)
    core = np.zeros((H, W), np.uint8)
    for cx, cy in CORES:
        cv2.circle(core, (cx, cy), 24, 1, -1)
    refl = (xx > 650) & (yy > 1170) & (lum > 120)
    mask = (pink | white | (core > 0) | refl).astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((5, 5), np.uint8)).astype(bool)

    out = bgr.copy()
    dark = lum < 75
    for y in range(H):
        row = mask[y]
        if not row.any():
            continue
        ok = ~row if y >= WATER_Y else (~row & dark[y])
        src_x = np.nonzero(ok)[0]
        if len(src_x) < 8:
            src_x = np.nonzero(~row)[0]
        if len(src_x) == 0:
            continue
        xs = np.nonzero(row)[0]
        # 연속 구간마다: 구간 왼쪽에 가장 가까운 출처 48개(없으면 오른쪽)를 반복
        runs = np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1)
        for run in runs:
            a = run[0]
            left = src_x[src_x < a][-48:]
            pool = left if len(left) >= 8 else src_x[src_x > run[-1]][:48]
            if len(pool) == 0:
                pool = src_x[:48]
            out[y, run] = bgr[y, pool[np.arange(len(run)) % len(pool)]]
    cv2.imwrite(dst, out)
    if len(sys.argv) > 3:
        vis = bgr.copy(); vis[mask] = (0, 255, 0); cv2.imwrite(sys.argv[3], vis)
    print("masked %.1f%%" % (100 * mask.mean()))


if __name__ == "__main__":
    main()
