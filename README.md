# 불꽃 호수

산과 호수만 있는 픽셀 그림에서, 좌클릭(터치)한 곳에 폭죽이 산 뒤에서 솟아올라 피고 호수에 비칩니다.

- `index.html`, `main.js` — 280×350 픽셀 격자 캔버스(조절값은 main.js 상단 CONFIG·TYPES)
- `assets/` — 바탕(base.png/svg), 앞가림 마스크(fg.png), meta.json
- `tools/build.py 원본.png` — 원본에서 불꽃을 지우고 플랫 픽셀 바탕·마스크를 다시 만듦
