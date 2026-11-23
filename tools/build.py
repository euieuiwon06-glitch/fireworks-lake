"""웹 바탕 만들기: 원본 → 불꽃 지우기 → 플랫 픽셀(4px) → 5칸 아래로 → assets/ 출력.

사용: python tools/build.py 원본.png
출력
- assets/base.png  280×350 바탕(산·물가만)
- assets/fg.png    280×350 앞가림 마스크(흰색 = 산·구름·땅: 폭죽이 이 뒤에 숨음)
- assets/base.svg  같은 바탕의 벡터
- assets/meta.json waterY(물 시작 행), skyline(열마다 앞가림 시작 행)
플랫 픽셀 변환 = 크리스마스/벡터/tools/flat_pixel_svg.py (--cell 4, 반사 채도 0.8·딤 0.85)
"""
import json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FLAT = os.path.join(ROOT, "..", "벡터", "tools", "flat_pixel_svg.py")
CELL, SHIFT, WATER_PX = 4, 5, 930
SKY_LUM = 75                # 이보다 어두우면 하늘 후보
MLINE0 = 132                # 산·구름 선을 찾기 시작하는 행
HIGH = 90                   # 이 행 위는 구름이 있어도 폭죽이 앞(높은 구름·별)
SKY_TOP, SKY_LOW = (16, 23, 56), (20, 37, 104)  # 하늘 위·아래 색(원본 팔레트)
SKY_EDGE = 108              # 하늘 두 색 경계(행, 물결 ±8)
STAR_ROWS = 100             # 이 행 위는 별만


def grid_svg(g, scale):
    sys.path.insert(0, os.path.dirname(FLAT))
    from png_to_pixel_svg import trace, loop_to_d
    H, W = g.shape[:2]
    key = g[..., 0].astype(int) << 16 | g[..., 1].astype(int) << 8 | g[..., 2]
    vals, cnt = np.unique(key, return_counts=True)
    order = vals[np.argsort(-cnt)]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W*scale}" height="{H*scale}" shape-rendering="crispEdges">',
             f'<rect width="{W}" height="{H}" fill="#{order[0]:06x}"/>']
    for v in order[1:]:
        loops, stride = trace(key == v)
        parts.append(f'<path fill="#{v:06x}" fill-rule="evenodd" d="{"".join(loop_to_d(l, stride) for l in loops)}"/>')
    return chr(10).join(parts + ["</svg>"])


def main():
    src = sys.argv[1]
    tmp = tempfile.mkdtemp()
    clean = os.path.join(tmp, "clean.png")
    subprocess.check_call([sys.executable, os.path.join(HERE, "clean_fireworks.py"), src, clean])
    svg = os.path.join(tmp, "base.svg"); prev = os.path.join(tmp, "prev.png")
    subprocess.check_call([sys.executable, FLAT, clean, svg, "--cell", str(CELL), "--water-y", str(WATER_PX),
                           "--reflect-dim", "0.85", "--preview", prev])
    big = np.asarray(Image.open(prev).convert("RGB"))
    g = big[CELL // 2::CELL, CELL // 2::CELL][:350, :280]
    H, W = g.shape[:2]
    # 아래로 SHIFT칸: 위 빈 줄은 맨 윗줄의 가장 흔한 색(하늘)
    cols, cnt = np.unique(g[0].reshape(-1, 3), axis=0, return_counts=True)
    sky0 = cols[cnt.argmax()]
    out = np.empty_like(g); out[SHIFT:] = g[:-SHIFT]; out[:SHIFT] = sky0
    water = WATER_PX // CELL + 1 + SHIFT

    # 하늘 = 맨 윗줄에서 어두운 칸(lum<SKY_LUM)으로만 4방향으로 이어지는 영역(물 위까지)
    lum = out.astype(float) @ [0.299, 0.587, 0.114]
    dark = lum < SKY_LUM
    # 산·구름 선: 열마다 MLINE0행 아래 처음 밝은 칸. 이 아래로는 하늘이 번지지 않음(산 어두운 몸통 보호)
    mline = []
    for x in range(W):
        ys = np.nonzero(lum[MLINE0:water, x] > 85)[0]
        mline.append(MLINE0 + int(ys[0]) if len(ys) else water)
    dark &= np.arange(H)[:, None] < np.array(mline)[None, :]
    sky = np.zeros((H, W), bool)
    stack = [(0, x) for x in range(W) if dark[0, x]]
    for y, x in stack:
        sky[y, x] = True
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < H and 0 <= nx < W and dark[ny, nx] and not sky[ny, nx]:
                sky[ny, nx] = True; stack.append((ny, nx))
    # 별·높은 구름(맨 위 HIGH행 위)도 폭죽이 앞에 오게 하늘 취급
    high = np.zeros((H, W), bool); high[:HIGH] = True
    visible = sky | high
    visible[water:] = False
    # 위쪽(STAR_ROWS행 위)은 별(밝은 점)만 남기고 나머지 조각은 하늘로
    top = np.zeros((H, W), bool); top[:STAR_ROWS] = True
    sky |= top & (lum < 150)
    # 하늘 칸: 무늬 없이 두 색 면(위 어두운 남색 / 아래 밝은 남색), 경계는 완만한 물결 계단
    xs = np.arange(W)
    edge = (SKY_EDGE + 5 * np.sin(xs / 23.0) + 3 * np.sin(xs / 9.7 + 1)).round().astype(int)
    for y, x in zip(*np.nonzero(sky)):
        out[y, x] = SKY_LOW if y >= edge[x] else SKY_TOP
    fg = np.where(visible | (np.arange(H)[:, None] >= water), 0, 255).astype(np.uint8)
    skyline = [int(np.nonzero(fg[:, x])[0][0]) if fg[:, x].any() else water for x in range(W)]

    A = os.path.join(ROOT, "assets"); os.makedirs(A, exist_ok=True)
    Image.fromarray(out).save(os.path.join(A, "base.png"))
    Image.fromarray(fg).save(os.path.join(A, "fg.png"))
    open(os.path.join(A, "base.svg"), "w", encoding="utf-8").write(grid_svg(out, CELL))
    json.dump({"w": W, "h": H, "waterY": water, "skyline": skyline},
              open(os.path.join(A, "meta.json"), "w"), separators=(",", ":"))
    print("water", water, "skyline min/max", min(skyline), max(skyline))


if __name__ == "__main__":
    main()
