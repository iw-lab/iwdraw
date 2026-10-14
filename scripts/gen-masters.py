#!/usr/bin/env python3
"""명화 팩 생성 — 퍼블릭 도메인 명화(작가 사후 70년 경과)를 위키미디어 공용에서 받아
아트온 도안 2종을 합성한다(캔버스 1536×1152 가로 4:3, contain-fit).

  masters_trace_*.webp   따라 그리기: 원본을 옅게(20%) 깔아 위에 덧그리는 밑그림
  masters_quarter_*.webp 1/4 완성하기: 좌상단 1/4은 원본 그대로 + 나머지는 옅게 + 십자 가이드

라이선스: 전 작품 작가 사후 70년 경과(한국 저작권법 기준 만료). 원본 사진은
위키미디어 공용 PD 스캔(평면 회화의 충실 복제 = 신규 저작권 불인정).
출처는 public/templates/masters/SOURCES.md 에 기록된다.

사용: python3 scripts/gen-masters.py [--work <임시폴더>]
재실행 안전(이미 받은 원본은 재사용, 출력은 덮어씀). manifest.json 갱신까지 수행.
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps, ImageStat

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "templates" / "masters"
MANIFEST = ROOT / "public" / "templates" / "manifest.json"

W, H = 1536, 1152  # 아트온 가로 캔버스와 동일(도안은 loadLineart가 contain-fit)
GUIDE_GRAY = 205

# 밑그림 농도는 그림마다 다르게 잡는다(2026-07-13 사용자 실측: 고정 20%는 모네
# 해돋이처럼 원래 대비가 낮은 그림에서 거의 안 보임 — "보고 그리기에 너무 흐리다").
# 블렌드 결과의 대비(표준편차)가 TARGET_STD가 되도록 알파를 역산 = 어떤 그림이든
# 비슷한 "읽힘". 대비 강한 그림(몬드리안)은 자동으로 옅게, 옅은 그림은 진하게.
# 2026-07-13 2차 실측: 22는 카드 썸네일·캔버스에서 여전히 옅다("너무 흐리지 않게")
TARGET_STD_TRACE = 30.0  # 따라 그리기: 형태가 또렷하되 내 획이 위에 확실히 보여야
TARGET_STD_QUARTER = 22.0  # 1/4 완성하기: 나머지 영역은 힌트 수준
# ⚠️ ALPHA_MAX 상한(2026-07-21 인상,해돋이 실측): 저대비 원작(해돋이 base_std 37.5)은
# std 목표를 맞추려 알파가 0.80까지 올라가 원색이 80% 남아 "안 흐린" 밑그림이 됐다.
# 형태는 0.55에서도 다 읽히므로(해·배·반영 확인) 상한을 0.55로 낮춰 항상 밑그림답게 유지.
ALPHA_MIN, ALPHA_MAX = 0.30, 0.55


# (slug, 한국어 제목, 작가, 사망년, [위키미디어 파일명 후보…])
# ⚠️ 전원 작가 사후 70년 경과(한국 저작권법 만료) — 신규 추가 시 사망년 확인 필수.
# 파일명은 위키미디어에서 개명되는 일이 있어 후보를 여러 개 둔다(실패 시 skip).
PAINTINGS = [
    # 반 고흐
    ("starry_night", "별이 빛나는 밤", "빈센트 반 고흐", 1890, ["Van Gogh - Starry Night - Google Art Project.jpg"]),
    ("bedroom", "아를의 침실", "빈센트 반 고흐", 1890, ["Vincent van Gogh - De slaapkamer - Google Art Project.jpg"]),
    ("sunflowers", "해바라기", "빈센트 반 고흐", 1890, ["Vincent Willem van Gogh 127.jpg", "Vincent van Gogh - Sunflowers (1888, National Gallery London).jpg"]),
    ("cafe_terrace", "밤의 카페 테라스", "빈센트 반 고흐", 1890, ["Vincent Willem van Gogh - Cafe Terrace at Night (Yorck).jpg"]),
    ("vg_selfportrait", "고흐 자화상", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Self-Portrait - Google Art Project (454045).jpg", "Vincent van Gogh - Self-portrait with grey felt hat - Google Art Project.jpg"]),
    # 모네·인상주의
    ("sunrise", "인상, 해돋이", "클로드 모네", 1926, ["Monet - Impression, Sunrise.jpg"]),
    ("water_lilies", "수련", "클로드 모네", 1926, ["Claude Monet - Water Lilies - 1906, Ryerson.jpg"]),
    ("japanese_bridge", "수련 연못의 다리", "클로드 모네", 1926, ["Claude Monet - Water Lilies and Japanese Bridge - Google Art Project.jpg"]),
    ("haystacks", "건초더미", "클로드 모네", 1926, ["Claude Monet - Meule - Google Art Project.jpg", "Monet haystacks"]),
    ("woman_parasol", "양산을 쓴 여인", "클로드 모네", 1926, ["Claude Monet - Woman with a Parasol - Madame Monet and Her Son - Google Art Project.jpg"]),
    ("moulin_galette", "물랭 드 라 갈레트의 무도회", "오귀스트 르누아르", 1919, ["Pierre-Auguste Renoir, Le Moulin de la Galette.jpg"]),
    ("ballet_class", "발레 수업", "에드가 드가", 1917, ["Edgar Degas - The Ballet Class - Google Art Project.jpg", "Edgar Degas - The Dance Class - Google Art Project.jpg"]),
    ("grande_jatte", "그랑드 자트 섬의 일요일 오후", "조르주 쇠라", 1891, ["A Sunday on La Grande Jatte, Georges Seurat, 1884.jpg"]),
    ("card_players", "카드놀이 하는 사람들", "폴 세잔", 1906, ["Paul Cézanne, Les joueurs de carte, 1892-95.jpg", "Les Joueurs de cartes, par Paul Cézanne.jpg"]),
    ("fifer", "피리 부는 소년", "에두아르 마네", 1883, ["Manet, Edouard - Young Flautist, or The Fifer, 1866 (2).jpg", "Manet Fifer"]),
    ("boating_lunch", "뱃놀이 일행의 점심", "오귀스트 르누아르", 1919, ["Pierre-Auguste Renoir - Luncheon of the Boating Party - Google Art Project.jpg"]),
    ("moulin_rouge", "물랭 루주에서", "앙리 드 툴루즈 로트렉", 1901, ["Henri de Toulouse-Lautrec - At the Moulin Rouge - Google Art Project.jpg"]),
    ("apples_oranges", "사과와 오렌지", "폴 세잔", 1906, ["Paul Cézanne - Apples and Oranges - Google Art Project.jpg", "Cezanne apples and oranges"]),
    ("sainte_victoire", "생트빅투아르 산", "폴 세잔", 1906, ["Paul Cézanne - Mont Sainte-Victoire - Google Art Project.jpg", "Cezanne Mont Sainte-Victoire"]),
    # 후기인상·표현주의
    ("scream", "절규", "에드바르 뭉크", 1944, ["The Scream.jpg"]),
    ("mondrian", "빨강·파랑·노랑의 구성", "피트 몬드리안", 1944, ["Piet Mondriaan, 1930 - Mondrian Composition II in Red, Blue, and Yellow.jpg"]),
    ("the_kiss", "키스", "구스타프 클림트", 1918, ["The Kiss - Gustav Klimt - Google Cultural Institute.jpg", "Gustav Klimt 016.jpg"]),
    ("tahiti_women", "타히티의 여인들", "폴 고갱", 1903, ["Paul Gauguin 056.jpg", "Paul Gauguin - Tahitian Women on the Beach - Google Art Project.jpg"]),
    ("irises", "아이리스(붓꽃)", "빈센트 반 고흐", 1890, ["Irises-Vincent van Gogh.jpg", "Van Gogh Irises 1889"]),
    ("kandinsky", "구성 8", "바실리 칸딘스키", 1944, ["Vassily Kandinsky, 1923 - Composition 8, huile sur toile, 140 cm x 201 cm, Musée Guggenheim, New York.jpg", "Kandinsky Composition VIII"]),
    ("senecio", "세네치오", "파울 클레", 1940, ["Paul Klee, Senecio, 1922.jpg", "Klee Senecio"]),
    # 사실주의·바로크·르네상스
    ("angelus", "만종", "장 프랑수아 밀레", 1875, ["JEAN-FRANÇOIS MILLET - El Ángelus (Museo de Orsay, 1857-1859. Óleo sobre lienzo, 55.5 x 66 cm).jpg", "Jean-François Millet (II) 013.jpg"]),
    ("gleaners", "이삭 줍는 사람들", "장 프랑수아 밀레", 1875, ["Jean-François Millet (II) - The Gleaners - Google Art Project 2.jpg", "Jean-François Millet (II) 001.jpg"]),
    ("pearl_earring", "진주 귀걸이를 한 소녀", "요하네스 베르메르", 1675, ["Meisje met de parel.jpg", "1665 Girl with a Pearl Earring.jpg"]),
    ("mona_lisa", "모나리자", "레오나르도 다 빈치", 1519, ["Mona Lisa, by Leonardo da Vinci, from C2RMF retouched.jpg"]),
    ("birth_venus", "비너스의 탄생", "산드로 보티첼리", 1510, ["Sandro Botticelli - La nascita di Venere - Google Art Project - edited.jpg"]),
    ("milkmaid", "우유 따르는 여인", "요하네스 베르메르", 1675, ["Johannes Vermeer - Het melkmeisje - Google Art Project.jpg"]),
    ("night_watch", "야경", "렘브란트", 1669, ["The Night Watch - HD.jpg", "Rembrandt Night Watch"]),
    ("last_supper", "최후의 만찬", "레오나르도 다 빈치", 1519, ["Leonardo da Vinci (1452-1519) - The Last Supper (1495-1498).jpg"]),
    ("school_athens", "아테네 학당", "라파엘로", 1520, ["\"The School of Athens\" by Raffaello Sanzio da Urbino.jpg", "Raphael School of Athens"]),
    ("creation_adam", "아담의 창조", "미켈란젤로", 1564, ["Michelangelo - Creation of Adam (cropped).jpg", "Creation of Adam Michelangelo"]),
    ("hunters_snow", "눈 속의 사냥꾼", "피터르 브뤼헐", 1569, ["Pieter Bruegel the Elder - Hunters in the Snow (Winter) - Google Art Project.jpg"]),
    ("tower_babel", "바벨탑", "피터르 브뤼헐", 1569, ["Pieter Bruegel the Elder - The Tower of Babel (Vienna) - Google Art Project - edited.jpg"]),
    ("arnolfini", "아르놀피니 부부의 초상", "얀 반 에이크", 1441, ["Van Eyck - Arnolfini Portrait.jpg"]),
    ("hay_wain", "건초 마차", "존 컨스터블", 1837, ["John Constable The Hay Wain.jpg", "Constable Hay Wain"]),
    ("rain_steam_speed", "비, 증기, 그리고 속도", "윌리엄 터너", 1851, ["Rain Steam and Speed the Great Western Railway.jpg"]),
    ("sower", "씨 뿌리는 사람", "장 프랑수아 밀레", 1875, ["Jean-François Millet - The Sower - Google Art Project.jpg", "Millet The Sower"]),
    ("napoleon_alps", "알프스를 넘는 나폴레옹", "자크 루이 다비드", 1825, ["Jacques-Louis David - Bonaparte franchissant le Grand-Saint-Bernard, 20 mai 1800 - Google Art Project.jpg"]),
    ("blue_boy", "푸른 옷의 소년", "토머스 게인즈버러", 1788, ["Thomas Gainsborough - The Blue Boy (c. 1770).jpg", "Gainsborough Blue Boy"]),
    # 동아시아
    ("great_wave", "가나가와 해변의 큰 파도", "가쓰시카 호쿠사이", 1849, ["Tsunami by hokusai 19th century.jpg"]),
    ("red_fuji", "붉은 후지산(개풍쾌청)", "가쓰시카 호쿠사이", 1849, ["Red Fuji southern wind clear morning.jpg"]),
    ("ssireum", "씨름", "김홍도", 1806, ["Danwon-Ssireum.jpg"]),
    ("seodang", "서당", "김홍도", 1806, ["Danwon Seodang.jpg", "Danwon-Seodang.jpg"]),
    ("mudong", "무동(춤추는 아이)", "김홍도", 1806, ["Danwon Mudong.jpg", "Kim Hongdo dance"]),
    # ⚠️ 신윤복 단오풍정 제외 — 목욕 장면(노출)이 있어 초등 교실용 부적합(2026-07-13 검수)
    ("inwang", "인왕제색도", "정선", 1759, ["Inwangjesaekdo.jpg", "Inwang jesaekdo"]),
    ("geumgang", "금강전도", "정선", 1759, ["Jeong Seon-Geumgang jeondo.jpg", "Geumgangjeondo"]),
    ("sehando", "세한도", "김정희", 1856, ["Sehando.jpg", "Kim Jeong-hui Sehando"]),
    ("mongyu", "몽유도원도", "안견", 1470, ["Dream Journey to the Peach Blossom Land.jpg", "Mongyudowondo An Gyeon"]),
    ("kkachi_horangi", "까치와 호랑이(민화)", "작자 미상(조선 민화)", 1800, ["Korean tiger and magpie painting.jpg", "Magpie and tiger minhwa"]),
    ("ejiri", "에지리의 바람(후가쿠 36경)", "가쓰시카 호쿠사이", 1849, ["Ejiri in Suruga Province.jpg", "Hokusai Ejiri in Suruga Province"]),
    ("hiroshige_rain", "오하시 다리에 내리는 소나기", "우타가와 히로시게", 1858, ["Hiroshige Atake sudden shower.jpg", "Sudden Shower over Shin-Ohashi Bridge and Atake"]),
    # 초등 교과·전시에 자주 나오는 PD 명화 추가(2026-07-13)
    # ⚠️ 육안 검수로 제외한 것들(재추가 금지): 쇠라 아니에르 물놀이·세잔 목욕하는 사람들·
    # 보스 쾌락의 정원(누드), 들라크루아 민중을 이끄는 자유(시체·노출), 밀레이 오필리아(익사),
    # 히로시게 아와의 소용돌이(검색 폴백이 실제 바다 사진을 가져옴), 프라고나르 그네(폴백 오류).
    ("wheatfield_crows", "까마귀 나는 밀밭", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Wheatfield with crows - Google Art Project.jpg"]),
    ("potato_eaters", "감자 먹는 사람들", "빈센트 반 고흐", 1890, ["Van-willem-vincent-gogh-die-kartoffelesser-03850.jpg", "Van Gogh The Potato Eaters"]),
    ("almond_blossom", "아몬드 꽃", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Almond blossom - Google Art Project.jpg"]),
    ("rouen_cathedral", "루앙 대성당", "클로드 모네", 1926, ["Claude Monet - Rouen Cathedral, Facade (Sunset).JPG", "Monet Rouen Cathedral"]),
    ("umbrellas", "우산", "오귀스트 르누아르", 1919, ["Pierre-Auguste Renoir - The Umbrellas - Google Art Project.jpg"]),
    ("girl_watering", "물뿌리개를 든 소녀", "오귀스트 르누아르", 1919, ["Pierre-Auguste Renoir - A Girl with a Watering Can - Google Art Project.jpg"]),
    ("little_dancer", "무대 위의 무희", "에드가 드가", 1917, ["Edgar Degas - The Star - Google Art Project.jpg", "Degas The Star dancer"]),
    ("circus", "서커스", "조르주 쇠라", 1891, ["Georges Seurat 019.jpg", "Seurat Le Cirque"]),
    ("van_gogh_chair", "고흐의 의자", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Van Gogh's Chair - Google Art Project.jpg"]),
    ("starry_rhone", "론강의 별이 빛나는 밤", "빈센트 반 고흐", 1890, ["Starry Night Over the Rhone.jpg"]),
    ("kiss_hayez", "입맞춤", "프란체스코 하예즈", 1882, ["Francesco Hayez 008.jpg", "Hayez Il bacio"]),
    ("wanderer_fog", "안개 바다 위의 방랑자", "카스파르 프리드리히", 1840, ["Caspar David Friedrich - Wanderer above the sea of fog.jpg"]),
    ("lady_ermine", "흰 담비를 안은 여인", "레오나르도 다 빈치", 1519, ["Lady with an Ermine - Leonardo da Vinci - Google Art Project.jpg"]),
    ("vitruvian", "비트루비우스적 인간", "레오나르도 다 빈치", 1519, ["Da Vinci Vitruve Luc Viatour.jpg"]),
    ("peasant_wedding", "농부의 결혼식", "피터르 브뤼헐", 1569, ["Pieter Bruegel de Oude - De boerenbruiloft.jpg"]),
    ("children_games", "아이들의 놀이", "피터르 브뤼헐", 1569, ["Pieter Bruegel the Elder - Children’s Games - Google Art Project.jpg", "Bruegel Children's Games"]),
    ("sunflowers_arles", "해바라기(뮌헨)", "빈센트 반 고흐", 1890, ["Vincent Willem van Gogh - Sunflowers - VGM F458.jpg", "Van Gogh Sunflowers Munich"]),
    ("saint_george", "성 게오르기우스와 용", "파올로 우첼로", 1475, ["Paolo Uccello 047b.jpg", "Uccello Saint George and the Dragon"]),
    ("bar_folies", "폴리 베르제르의 바", "에두아르 마네", 1883, ["Edouard Manet, A Bar at the Folies-Bergère.jpg"]),
    ("whistlers_mother", "화가의 어머니", "제임스 휘슬러", 1903, ["Whistlers Mother high res.jpg", "Whistler's Mother"]),
    ("american_landscape", "건초 만드는 사람들", "쥘 바스티앵르파주", 1884, ["Jules Bastien-Lepage - Les Foins.jpg", "Bastien-Lepage Les Foins"]),
    ("fuji_kanagawa2", "후지산과 번개(산하백우)", "가쓰시카 호쿠사이", 1849, ["Lightnings below the summit.jpg", "Hokusai Rainstorm Beneath the Summit"]),
    ("hiroshige_plum", "가메이도의 매화 정원", "우타가와 히로시게", 1858, ["Hiroshige Plum Park in Kameido.jpg", "Hiroshige Plum Garden Kameido"]),
    ("bird_flower", "화조도(민화)", "작자 미상(조선 민화)", 1800, ["Korean folk painting bird flower.jpg", "Minhwa hwajodo bird flower Korea"]),
    ("chaekgeori", "책가도(민화)", "작자 미상(조선 민화)", 1800, ["Chaekgeori.jpg", "Chaekgeori books scholar painting"]),
    ("juksan", "묵죽도", "이정", 1626, ["Yi Jeong-Bamboo.jpg", "Korean ink bamboo painting Joseon"]),
    # ── 2026-07-21 대폭 확장(최대한 많이) — 전원 작가 사후 70년+ PD, 초등 교실 적합 육안 기준 ──
    # 반 고흐(1890)
    ("olive_trees", "올리브 나무", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Olive Trees - Google Art Project.jpg", "Van Gogh Olive Trees"]),
    ("red_vineyard", "아를의 붉은 포도밭", "빈센트 반 고흐", 1890, ["Red vineyards.jpg", "Van Gogh The Red Vineyard"]),
    ("green_wheat", "초록 밀밭", "빈센트 반 고흐", 1890, ["Vincent van Gogh - Green Wheat Fields, Auvers.jpg", "Van Gogh Green Wheat Fields Auvers"]),
    ("fishing_boats", "생트마리의 고깃배", "빈센트 반 고흐", 1890, ["Fishing Boats on the Beach at Saintes-Maries.jpg", "Van Gogh Fishing Boats Saintes-Maries"]),
    # 모네(1926)
    ("poppies", "개양귀비 들판", "클로드 모네", 1926, ["Claude Monet 024.jpg", "Monet Poppy Field Argenteuil"]),
    ("parliament", "국회의사당", "클로드 모네", 1926, ["Claude Monet - The Houses of Parliament, Sunset.jpg", "Monet Houses of Parliament Sunset"]),
    ("artist_garden_giverny", "지베르니의 화가 정원", "클로드 모네", 1926, ["Claude Monet - The Artist's Garden at Giverny.jpg", "Monet Artist's Garden Giverny"]),
    ("saint_lazare", "생라자르 역", "클로드 모네", 1926, ["Claude Monet - Arrival of the Normandy Train, Gare Saint-Lazare.jpg", "Monet Gare Saint-Lazare"]),
    # 르누아르·드가·세잔
    ("dance_bougival", "부지발의 무도회", "오귀스트 르누아르", 1919, ["Pierre-Auguste Renoir, Dance at Bougival.jpg", "Renoir Dance at Bougival"]),
    ("rehearsal", "무용 리허설", "에드가 드가", 1917, ["Edgar Degas - The Rehearsal - Google Art Project.jpg", "Degas The Rehearsal"]),
    ("basket_apples", "사과 바구니", "폴 세잔", 1906, ["Paul Cézanne - The Basket of Apples - Google Art Project.jpg", "Cezanne The Basket of Apples"]),
    # 클림트(1918)
    ("adele", "아델레 블로흐바우어의 초상", "구스타프 클림트", 1918, ["Gustav Klimt 046.jpg", "Adele Bloch-Bauer I Klimt"]),
    # 베르메르(1675)
    ("geographer", "지리학자", "요하네스 베르메르", 1675, ["Johannes Vermeer - The Geographer - Google Art Project.jpg", "Vermeer The Geographer"]),
    ("view_delft", "델프트 풍경", "요하네스 베르메르", 1675, ["Vermeer-view-of-delft.jpg", "Vermeer View of Delft"]),
    ("little_street", "골목길", "요하네스 베르메르", 1675, ["Johannes Vermeer - Gezicht op huizen in Delft, bekend als 'Het straatje' - Google Art Project.jpg", "Vermeer The Little Street"]),
    # 렘브란트·터너·벨라스케스
    ("rembrandt_self", "렘브란트 자화상", "렘브란트", 1669, ["Rembrandt van Rijn - Self-Portrait - Google Art Project.jpg", "Rembrandt Self-Portrait 1659"]),
    ("fighting_temeraire", "전함 테메레르", "윌리엄 터너", 1851, ["The Fighting Temeraire, JMW Turner, National Gallery.jpg", "Turner Fighting Temeraire"]),
    ("meninas", "시녀들", "디에고 벨라스케스", 1660, ["Las Meninas, by Diego Velázquez, from Prado in Google Earth.jpg", "Las Meninas Velazquez"]),
    # 브뤼헐·보티첼리·뒤러·아르침볼도
    ("harvesters", "추수하는 사람들", "피터르 브뤼헐", 1569, ["Pieter Bruegel the Elder- The Harvesters - Google Art Project.jpg", "Bruegel The Harvesters"]),
    ("netherlandish_proverbs", "네덜란드 속담", "피터르 브뤼헐", 1569, ["Pieter Brueghel the Elder - The Dutch Proverbs - Google Art Project.jpg", "Bruegel Netherlandish Proverbs"]),
    ("durer_hare", "산토끼", "알브레히트 뒤러", 1528, ["Dürer - Young Hare.jpg", "Durer Young Hare"]),
    ("arcimboldo", "베르툼누스(과일 얼굴)", "주세페 아르침볼도", 1593, ["Giuseppe Arcimboldo - Vertumnus - Google Art Project.jpg", "Arcimboldo Vertumnus"]),
    ("whistlejacket", "휘슬재킷(말)", "조지 스터브스", 1806, ["Whistlejacket by George Stubbs.jpg", "Stubbs Whistlejacket"]),
    # 20세기 초 색채·나이브(아동 친화)
    ("blue_horses", "푸른 말들", "프란츠 마르크", 1916, ["The Large Blue Horses.jpg", "Franz Marc Large Blue Horses"]),
    ("kandinsky_yrb", "노랑·빨강·파랑", "바실리 칸딘스키", 1944, ["Vassily Kandinsky, 1925 - Yellow-Red-Blue.jpg", "Kandinsky Yellow Red Blue"]),
    ("klee_castle_sun", "성과 태양", "파울 클레", 1940, ["Paul Klee - Castle and Sun.jpg", "Klee Castle and Sun"]),
    ("rousseau_tiger", "놀란!(열대 폭풍 속 호랑이)", "앙리 루소", 1910, ["Henri Rousseau - Tiger in a Tropical Storm (Surprised!) - Google Art Project.jpg", "Rousseau Surprised Tiger"]),
    ("rousseau_gypsy", "잠자는 집시", "앙리 루소", 1910, ["Henri Rousseau - The Sleeping Gypsy - Google Art Project.jpg", "Rousseau Sleeping Gypsy"]),
    ("munch_bridge", "다리 위의 소녀들", "에드바르 뭉크", 1944, ["Edvard Munch - The Girls on the Bridge.jpg", "Munch Girls on the Bridge"]),
    # 미국·인상주의(가족·아이 소재, 아동 친화)
    ("carnation_lily", "카네이션, 백합, 백합, 장미", "존 싱어 사전트", 1925, ["John Singer Sargent - Carnation, Lily, Lily, Rose - Google Art Project.jpg", "Sargent Carnation Lily Lily Rose"]),
    ("cassatt_boating", "뱃놀이 일행", "메리 커샛", 1926, ["Mary Cassatt - The Boating Party - Google Art Project.jpg", "Cassatt The Boating Party"]),
    ("snap_whip", "채찍놀이", "윈슬로 호머", 1910, ["Winslow Homer - Snap the Whip - Google Art Project.jpg", "Homer Snap the Whip"]),
    # 동아시아 추가
    ("hokusai_waterfall", "기리후리 폭포", "가쓰시카 호쿠사이", 1849, ["Kirifuri Waterfall at Kurokami Mountain in Shimotsuke.jpg", "Hokusai Kirifuri Waterfall"]),
    ("hiroshige_saruwaka", "밤의 사루와카초", "우타가와 히로시게", 1858, ["Hiroshige Saruwaka-machi.jpg", "Hiroshige Night View Saruwaka-machi"]),
    ("wind_thunder", "바람신과 천둥신", "다와라야 소타쓰", 1643, ["Fujin and Raijin by Tawaraya Sotatsu.jpg", "Wind God and Thunder God Sotatsu"]),
    ("pine_trees", "송림도(소나무 병풍)", "하세가와 도하쿠", 1610, ["Pine Trees (Shōrin-zu byōbu) by Hasegawa Tōhaku.jpg", "Hasegawa Tohaku Pine Trees"]),
    # 한국 추가
    ("miindo", "미인도", "신윤복", 1813, ["Hyewon-Miindo.jpg", "Hyewon, Miindo 2.jpg"]),
    ("kim_threshing", "타작", "김홍도", 1806, ["Danwon Tajak.jpg", "Kim Hongdo threshing Danwon"]),
    ("chochungdo", "초충도(풀과 벌레)", "신사임당", 1551, ["Chochungdo 06.jpg", "Chochungdo 04.jpg"]),
    ("pajeokdo", "파적도(야묘도추·들고양이)", "김득신", 1822, ["Kim Deuksin - Pajeokdo.jpg", "Kim Deuk-sin Pajeokdo"]),
]

# ── 2026-10-14 우리 미술관 게임(명화 탐험대 · 교육용브라우저/art-museum)에 걸린 작품 ──
# 아이가 미술관에서 본 그림을 아트온에서 따라 그린다. 원본 = 그 게임이 미술관 오픈 액세스(CC0·PD)에서
# 받아 둔 2560px 사본이고, 작가·사망년·출처·라이선스는 그 게임의 data/artworks.json 을 그대로 읽는다.
# 처음 한 번 work 폴더(<slug>.img)로 복사해 두므로 그 저장소가 없는 맥에서도 재실행된다.
# ⚠️ 육안 검수로 뺀 것(재추가 금지): 종교화 전부, 8폭 병풍처럼 칸이 쪼개진 것(난초와 바위·사계절 산수),
#    너무 어두워 밑그림이 안 읽히는 것(인물이 있는 설경·젊은 부부가 있는 실내·하루 일을 평가하다·달밤의 뱃놀이).
MUSEUM_DIR = Path.home() / "Documents" / "dev" / "교육용브라우저" / "art-museum"
# (slug, 아트온 제목 — 길면 줄임, 미술관 게임 작품 id)
MUSEUM = [
    # 인상주의와 그 후
    ("mu_two_sisters", "테라스의 두 자매", "aic:14655"),
    ("mu_acrobats", "페르난도 서커스의 곡예사들", "aic:81558"),
    ("mu_opera_ballet", "파리 오페라 극장의 발레", "aic:61603"),
    ("mu_marseille", "레스타크에서 본 마르세유 만", "aic:16487"),
    ("mu_place_havre", "파리 아브르 광장", "aic:81551"),
    ("mu_sisley_seine", "센강의 모래 더미", "aic:16633"),
    ("mu_balcony", "발코니에서", "aic:13916"),
    ("mu_longchamp", "롱샹의 경마", "aic:81533"),
    ("mu_rainy_paris", "파리의 거리, 비 오는 날", "aic:20684"),
    ("mu_signac_andelys", "레장들리의 강가", "aic:122130"),
    # 동아시아의 붓과 판화
    ("mu_cranes_pine", "눈 덮인 소나무 위의 학", "aic:21720"),
    ("mu_mitsuke_ferry", "덴류강을 건너는 나룻배", "aic:4368"),
    ("mu_shono_shower", "쇼노의 소나기", "cma:1948.306"),
    ("mu_red_parrot", "나뭇가지 위의 붉은 앵무새", "aic:197424"),
    ("mu_rooster_hen", "포도 넝쿨 아래 암탉과 수탉", "met:40459"),
    ("mu_chrysanthemums", "시냇가의 국화", "cma:1958.206.2"),
    ("mu_shenzhou_clouds", "비 오기 전 강 위의 구름", "aic:13455"),
    ("mu_horse_groom", "말과 마부", "met:40507"),
    ("mu_maple_viewing", "단풍 구경", "aic:24927"),
    ("mu_omori_seaweed", "오모리에서 김 따기", "aic:7691"),
    # 한국의 미
    ("mu_tiger_family", "호랑이 가족(민화)", "cma:1997.148"),
    ("mu_lotus_birds", "연꽃과 곤충과 새", "cma:1985.18"),
    ("mu_guryong_falls", "구룡폭포", "cma:1915.215"),
    ("mu_tiger_leopard", "뛰노는 호랑이와 표범", "cma:1998.292"),
    ("mu_white_falcon", "흰 매", "cma:2026.15"),
    # 르네상스와 바로크
    ("mu_ruisdael_falls", "숲속의 폭포", "cma:1967.63"),
    ("mu_bruegel_rabbit", "토끼 사냥", "cma:2009.80"),
    ("mu_canaletto_dolo", "돌로의 운하 갑문", "cma:1925.1239.6"),
    # 북유럽의 빛
    ("mu_herring_fishers", "청어 잡는 어부들", "smk:DEP976"),
    ("mu_thaw", "눈 녹는 날", "smk:KMS7709"),
    ("mu_boy_studio", "화가의 작업실에 있는 소년", "smk:KMS1767"),
    ("mu_mother_child", "엄마와 아이", "smk:KMS9107"),
    ("mu_rye_field", "링 마을의 호밀밭", "smk:KMS6449"),
    ("mu_winter_kravsholm", "크라베스홀름의 겨울", "smk:KMS3929"),
]


def commons_search(query: str, limit: int = 4) -> list[str]:
    """커먼즈 파일 검색 — 정확한 파일명을 몰라도(개명·이형) 상위 후보를 얻는다."""
    import urllib.parse

    url = (
        "https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch="
        + urllib.parse.quote(f"filetype:bitmap {query}")
        + f"&srnamespace=6&srlimit={limit}&format=json"
    )
    r = subprocess.run(["curl", "-s", "--max-time", "30", url], capture_output=True)
    try:
        hits = json.loads(r.stdout)["query"]["search"]
    except Exception:
        return []
    return [h["title"].removeprefix("File:") for h in hits]


def download(names: list[str], dest: Path) -> bool:
    """위키미디어 Special:FilePath — 파일명 후보를 순서대로 시도(개명·이형 대응).
    후보가 모두 실패하면 마지막 항목을 검색어로 커먼즈 검색 폴백."""
    if dest.exists() and dest.stat().st_size > 50_000:
        return True

    def fetch(name: str) -> bool:
        url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + name.replace(" ", "_") + "?width=1600"
        r = subprocess.run(
            ["curl", "-sL", "--max-time", "120", "-A", "ArtON-edu/1.0 (classroom art app; PD sources)", "-o", str(dest), url],
            capture_output=True,
        )
        if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 50_000:
            dest.unlink(missing_ok=True)
            return False
        try:
            Image.open(dest).verify()
            return True
        except Exception:
            dest.unlink(missing_ok=True)
            return False

    for name in names:
        if fetch(name):
            return True
    # 폴백: 마지막 후보를 검색어로 커먼즈 검색(파일명이 개명됐거나 오타여도 잡힘)
    for name in commons_search(names[-1]):
        if fetch(name):
            print(f"  (검색 폴백으로 찾음: {name})", file=sys.stderr)
            return True
    return False


def fit_on_canvas(img: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    """흰 캔버스(1536×1152)에 contain-fit. 배치 rect(x0,y0,x1,y1) 반환."""
    img = img.convert("RGB")
    scale = min(W / img.width, H / img.height)
    dw, dh = round(img.width * scale), round(img.height * scale)
    fitted = img.resize((dw, dh), Image.LANCZOS)
    canvas = Image.new("RGB", (W, H), "white")
    x0, y0 = (W - dw) // 2, (H - dh) // 2
    canvas.paste(fitted, (x0, y0))
    return canvas, (x0, y0, x0 + dw, y0 + dh)


def prepped(canvas: Image.Image) -> Image.Image:
    """밑그림 소스 보정 — 옅은 원작(모네 해돋이 등)도 형태가 읽히게.
    ① autocontrast(양끝 0.5% 컷)로 톤 레인지 확장 ② 채도를 약간 낮춰(0.85) 밑그림이
    아이 물감색과 경쟁하지 않게. 원작 재현이 아니라 '보고 그리는 밑그림'이 목적."""
    c = ImageOps.autocontrast(canvas, cutoff=0.5)
    return ImageEnhance.Color(c).enhance(0.85)


def faint_adaptive(canvas: Image.Image, target_std: float) -> tuple[Image.Image, float]:
    """흰 배경과 블렌드하되, 결과 대비(표준편차)가 target_std가 되도록 알파를 역산.
    blend(white, img, a)의 표준편차는 a × std(img) — 선형이라 역산이 정확하다."""
    src = prepped(canvas)
    base = ImageStat.Stat(src.convert("L")).stddev[0]
    alpha = target_std / base if base > 1 else ALPHA_MAX
    alpha = max(ALPHA_MIN, min(ALPHA_MAX, alpha))
    white = Image.new("RGB", src.size, "white")
    return Image.blend(white, src, alpha), alpha


def save_webp(img: Image.Image, path: Path) -> None:
    img.save(path, "WEBP", quality=84, method=4)


def compose(slug: str, src: Path) -> bool:
    """원본 한 장 → 따라 그리기·1/4 완성하기 두 장. 한 장이 깨져도(손상 이미지·이형 포맷) 전체 run이 죽지 않게 격리한다."""
    try:
        canvas, rect = fit_on_canvas(Image.open(src))

        # 따라 그리기: 전체를 적응형 농도로(대비 목표 기준 — 그림마다 알파가 다르다)
        trace, a_t = faint_adaptive(canvas, TARGET_STD_TRACE)
        save_webp(trace, OUT_DIR / f"masters_trace_{slug}.webp")

        # 1/4 완성하기: 옅은 전체 + 좌상단 1/4 원본 + 십자 가이드(그림 rect 기준)
        q, a_q = faint_adaptive(canvas, TARGET_STD_QUARTER)
        x0, y0, x1, y1 = rect
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        q.paste(canvas.crop((x0, y0, cx, cy)), (x0, y0))
        d = ImageDraw.Draw(q)
        g = (GUIDE_GRAY,) * 3
        d.line([(x0, cy), (x1, cy)], fill=g, width=3)
        d.line([(cx, y0), (cx, y1)], fill=g, width=3)
        save_webp(q, OUT_DIR / f"masters_quarter_{slug}.webp")
    except Exception as e:  # noqa: BLE001 — 손상 이미지 격리, 다음 그림 계속
        print(f"skip (처리 실패): {slug} — {e}", file=sys.stderr)
        return False
    print(f"ok: {slug} — trace α={a_t:.2f} quarter α={a_q:.2f}")
    return True


def main() -> None:
    work = Path(sys.argv[sys.argv.index("--work") + 1]) if "--work" in sys.argv else ROOT / ".masters-work"
    work.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    ok_list = []
    for slug, title, artist, died, fnames in PAINTINGS:
        src = work / f"{slug}.img"
        if not download(fnames, src):
            print(f"skip (다운로드 실패): {slug} — {fnames[0]}", file=sys.stderr)
            continue
        if not compose(slug, src):
            continue
        ok_list.append((slug, title, artist, died, "https://commons.wikimedia.org/wiki/File:" + fnames[0].replace(" ", "_")))

    # 미술관 게임 작품 — 원본·작가·출처를 그 게임 데이터에서 읽는다(처음 한 번 work 로 복사)
    artworks_json = MUSEUM_DIR / "data" / "artworks.json"
    try:
        artworks = {a["id"]: a for a in json.loads(artworks_json.read_text(encoding="utf-8"))} if artworks_json.exists() else {}
    except (ValueError, KeyError, TypeError) as e:  # 깨진 데이터 — 미술관 작품만 work 캐시로 가고 목록 갱신은 계속(교차검증 지적)
        print(f"⚠️ 미술관 게임 데이터를 못 읽음({e}) — work 캐시로만 진행", file=sys.stderr)
        artworks = {}
    museum_meta_path = work / "museum-meta.json"
    museum_meta = json.loads(museum_meta_path.read_text(encoding="utf-8")) if museum_meta_path.exists() else {}
    for slug, title, aid in MUSEUM:
        src = work / f"{slug}.img"
        a = artworks.get(aid)
        if a:
            if not src.exists():
                shutil.copyfile(MUSEUM_DIR / a["img"]["zoom"], src)
            artist = (a.get("artist") or {}).get("ko") or "작자 미상"
            museum_meta[slug] = {
                "artist": artist,
                "died": a["license"].get("krCopyright", "").replace("작가 사망 ", ""),
                "source": f'{a["museum"]["ko"]} {a["source"]["url"]} ({a["license"]["type"]})',
            }
        if not src.exists() or slug not in museum_meta:
            print(f"skip (미술관 게임 원본 없음): {slug} — {aid}", file=sys.stderr)
            continue
        if not compose(slug, src):
            continue
        meta = museum_meta[slug]
        ok_list.append((slug, title, meta["artist"], meta["died"], meta["source"]))
    museum_meta_path.write_text(json.dumps(museum_meta, ensure_ascii=False, indent=1), encoding="utf-8")

    if not ok_list:
        sys.exit("생성된 명화가 없습니다")

    # ── SOURCES.md (출처·라이선스 기록) ──
    lines = [
        "# 명화 팩 출처 (전부 퍼블릭 도메인)\n",
        "모든 작품은 작가 사후 70년이 지나 한국 저작권법상 보호기간이 만료되었습니다.",
        "원본 이미지는 위키미디어 공용의 PD 스캔(평면 회화의 충실한 복제)이고, `mu_` 작품은 우리 미술관 게임(명화 탐험대)이",
        "미술관 오픈 액세스(CC0·PD)에서 받은 사본입니다.\n",
        "| 파일 | 작품 | 작가(사망년) | 원본 |",
        "|---|---|---|---|",
    ]
    for slug, title, artist, died, url in ok_list:
        lines.append(f"| masters_*_{slug}.webp | {title} | {artist}(†{died}) | {url} |")
    (OUT_DIR / "SOURCES.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    # ── manifest.json 갱신(멱등: masters 항목은 매번 재구성) ──
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    m["categories"] = [c for c in m["categories"] if c["id"] != "masters"]
    m["categories"].append({
        "id": "masters",
        "title": "명화",
        "emoji": "🖼️",
        "themes": ["masters_trace", "masters_quarter"],
        "partial": True,
    })
    trace_items = [
        {"id": f"masters_trace_{slug}", "title": f"{title} 따라 그리기", "grade": "high",
         "image": f"/templates/masters/masters_trace_{slug}.webp"}
        for slug, title, *_ in ok_list
    ]
    quarter_items = [
        {"id": f"masters_quarter_{slug}", "title": f"{title} 1/4 완성하기", "grade": "mid",
         "image": f"/templates/masters/masters_quarter_{slug}.webp"}
        for slug, title, *_ in ok_list
    ]
    m["themes"]["masters_trace"] = {
        "theme": "masters_trace", "title": "명화 따라 그리기", "category": "masters",
        "count": len(trace_items), "cover": trace_items[0]["image"], "items": trace_items,
    }
    m["themes"]["masters_quarter"] = {
        "theme": "masters_quarter", "title": "명화 1/4 완성하기", "category": "masters",
        "count": len(quarter_items), "cover": quarter_items[0]["image"], "items": quarter_items,
    }
    MANIFEST.write_text(json.dumps(m, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n완료: {len(ok_list)}점 × 2종, manifest 갱신")
    # 위에서 masters 항목을 새로 만들면 thumb 필드가 빠진다 → 썸네일을 다시 채운다(빠지면 격자가 원본 1.5MB 급을 받는다)
    subprocess.run(["node", str(ROOT / "scripts" / "gen-template-thumbs.mjs")], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
