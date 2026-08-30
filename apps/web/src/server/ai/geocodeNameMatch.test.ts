import { describe, expect, it } from "vitest";
import { candidateOwnName, distinctiveTokens, nameTokens, placeNameVerdict } from "./geocodeNameMatch";

describe("nameTokens", () => {
  it("folds diacritics so Gōra and Gora are the same token", () => {
    expect(nameTokens("Gōra Kadan")).toEqual(["gora", "kadan"]);
    expect(nameTokens("Chūzenji")).toEqual(["chuzenji"]);
  });

  it("splits on punctuation and case, keeping digits", () => {
    expect(nameTokens("TRUNK (HOTEL) cat street")).toEqual(["trunk", "hotel", "cat", "street"]);
    expect(nameTokens("Shin-Osaka Station")).toEqual(["shin", "osaka", "station"]);
    expect(nameTokens("HND Terminal 3")).toEqual(["hnd", "terminal", "3"]);
    expect(nameTokens("% Arabica")).toEqual(["arabica"]);
  });

  // The property the "not-comparable" verdict rests on.
  it("yields nothing for a name written entirely in local script", () => {
    expect(nameTokens("明治神宮")).toEqual([]);
    expect(nameTokens("チームラボ プラネッツ")).toEqual([]);
  });
});

describe("distinctiveTokens", () => {
  it("drops category nouns and the geography already in the query", () => {
    expect(distinctiveTokens("Zentis Osaka", ["Kita", "Osaka", "Japan"])).toEqual(["zentis"]);
    expect(distinctiveTokens("Kegon Falls", ["Chūzenji", "Nikkō", "Japan"])).toEqual(["kegon"]);
    expect(distinctiveTokens("Gion Nanba", ["Gion", "Kyoto", "Japan"])).toEqual(["nanba"]);
  });

  // "Shin-Osaka Station" is queried under city Tokyo (the seed labels the day
  // by destination), so "osaka" is NOT context here and stays distinctive.
  it("keeps a city word that is not this query's own city", () => {
    expect(distinctiveTokens("Shin-Osaka Station", ["Yodogawa", "Tokyo", "Japan"])).toEqual(["shin", "osaka"]);
  });

  it("falls back to the whole name rather than requiring nothing", () => {
    expect(distinctiveTokens("Osaka Castle", ["Chūō", "Osaka", "Japan"])).toEqual(["osaka", "castle"]);
  });
});

describe("candidateOwnName", () => {
  it("takes only the leading segment of a display_name", () => {
    expect(candidateOwnName("Bakery & Table, Hakone, Kanagawa Prefecture, Japan")).toBe("Bakery & Table");
    expect(candidateOwnName("品川駅 (Shinagawa Station), Minato, Tokyo, Japan")).toBe("品川駅 (Shinagawa Station)");
  });
});

// The regression table. Every row is a REAL LocationIQ answer from the
// 2026-08-25 geocode-japan-seed run (commit 7fb5da2's overlay), including all
// three wrong-venue pins CodeRabbit hand-caught on PR #46 and the eight more
// the same run shipped. Each of these passed `withinBox` — the box is what
// could not tell them apart, which is KI-39.
describe("placeNameVerdict — the KI-39 wrong-venue candidates", () => {
  const CONTEXT_BY_CITY = (area: string, city: string) => [area, city, "Japan"];

  const WRONG_VENUE: [place: string, area: string, city: string, displayName: string][] = [
    // The three deleted from the overlay by hand.
    ["Kegon Falls", "Chūzenji", "Nikkō", "Urami Falls, Nikko, Tochigi Prefecture, Japan"],
    ["Zentis Osaka", "Kita", "Osaka", "Hotels Inn Osaka KitaUmeda, Osaka-shi, Osaka, Osaka Prefecture, Japan"],
    ["Shin-Osaka Station", "Yodogawa", "Tokyo", "品川駅 (Shinagawa Station), Minato, Tokyo, Minato, Tokyo, Japan"],
    // Eight the same run also accepted on the box alone.
    ["Hama-rikyū Gardens", "Hamamatsuchō", "Tokyo", "Tokyo, Chiyoda, Tokyo, Japan"],
    ["Torishiki", "Meguro", "Tokyo", "MeGuro, Shinagawa, Tokyo, Shinagawa, Tokyo, Japan"],
    ["Bread & Espresso", "Omotesandō", "Tokyo", "Cawaii Bread & Coffee, 16, Chūō, Tokyo, Chuo, Tokyo, 104-0032, Japan"],
    ["Afuri", "Harajuku", "Tokyo", "WITH HARAJUKU, 30, Shibuya, Tokyo, Shibuya, Tokyo, 150-0001, Japan"],
    ["Sushi Yoshitake", "Ginza", "Tokyo", "Sushi Wasabi, Shinjuku, Tokyo, Shinjuku, Tokyo, 160-0004, Japan"],
    ["Gion Nanba", "Gion", "Kyoto", "GION KIMUTAKO, 16-1, 大和大路, Kyoto-shi, Kyoto, Kyoto Prefecture, Japan"],
    ["Yoshida-ya", "Arashiyama", "Kyoto", "Coffee Yoshida, Kyoto-shi, Kyoto, Kyoto Prefecture, Japan"],
    ["Kichi Kichi", "Pontochō", "Kyoto", "KICHIRI 河原町店, Kyoto-shi, Kyoto, Kyoto Prefecture, Japan"],
  ];

  it.each(WRONG_VENUE)("rejects %s (%s, %s) -> %s", (place, area, city, displayName) => {
    expect(placeNameVerdict(place, displayName, CONTEXT_BY_CITY(area, city))).toBe("mismatch");
  });

  const RIGHT_VENUE_ROMANISED: [place: string, area: string, city: string, displayName: string][] = [
    ["Trunk Hotel", "Shibuya", "Tokyo", "TRUNK (HOTEL) cat street, 神宮前五丁目, 渋谷区, 東京都, 日本"],
    ["Bar Trench", "Ebisu", "Tokyo", "Bar TRENCH, 恵比寿一番街, 渋谷区, 東京都, 日本"],
    ["Den", "Jingūmae", "Tokyo", "Den, 外苑西通り, 神宮前二丁目, 渋谷区, 東京都, 日本"],
    ["Kagari", "Ginza", "Tokyo", "Kagari, 銀座ガス灯通り, 中央区, 東京都, 日本"],
    ["Bakery & Table", "Motohakone", "Hakone", "Bakery & Table, Hakone, Kanagawa Prefecture, Japan"],
    ["Gora Kadan", "Gōra", "Hakone", "Gōra Kadan, Hakone, Kanagawa Prefecture, Japan"],
    ["% Arabica", "Higashiyama", "Kyoto", "% Arabica, 維新の道, 東山区, 京都市, 京都府, 日本"],
    ["Monk", "Sakyō", "Kyoto", "monk, 哲学の道, 左京区, 京都市, 京都府, 日本"],
    ["Handicraft Center", "Sakyō", "Kyoto", "京都ハンディクラフトセンター (Kyoto Handicraft Center), 17, 左京区, 京都市, 日本"],
    ["Harukoma Sushi", "Nakazakichō", "Osaka", "Harukoma Sushi, Osaka-shi, Osaka, Osaka Prefecture, Japan"],
    ["Mel Coffee Roasters", "Nishi", "Osaka", "Mel Coffee Roasters, 新町通, 西区, 大阪市, 大阪府, 日本"],
    ["Yaekatsu", "Naniwa", "Osaka", "Yaekatsu, ジャンジャン横丁, 浪速区, 大阪市, 大阪府, 日本"],
  ];

  it.each(RIGHT_VENUE_ROMANISED)("keeps %s (%s, %s) -> %s", (place, area, city, displayName) => {
    expect(placeNameVerdict(place, displayName, CONTEXT_BY_CITY(area, city))).toBe("match");
  });

  // Not "mismatch": rejecting these would have thrown away 29 of the 54
  // resolutions, every one of them the right place. The caller accepts them on
  // the box and reports them as unverified (see the script's run report).
  const LOCAL_SCRIPT_ONLY: [place: string, area: string, city: string, displayName: string][] = [
    ["Meiji Jingū", "Yoyogi", "Tokyo", "明治神宮, 1, 代々木神園町, 渋谷区, 東京都, 日本"],
    ["teamLab Planets", "Toyosu", "Tokyo", "チームラボ プラネッツ, 16, 豊洲六丁目, 江東区, 東京都, 日本"],
    ["Tsukiji Outer Market", "Tsukiji", "Tokyo", "築地場外市場, 波除通り, 中央区, 東京都, 日本"],
    ["Tobu Nikkō Station", "Nikkō", "Nikkō", "東武日光駅, 日光街道, 日光市, 栃木県, 日本"],
    ["Osaka Castle", "Chūō", "Osaka", "大阪城, 1, 中央区, 大阪市, 大阪府, 日本"],
  ];

  it.each(LOCAL_SCRIPT_ONLY)("cannot judge %s (%s, %s) -> %s", (place, area, city, displayName) => {
    expect(placeNameVerdict(place, displayName, CONTEXT_BY_CITY(area, city))).toBe("not-comparable");
  });

  // Unscheduled backlog items are queried without a city (the seed gives them
  // none), so only the area is discounted.
  it("judges an unscheduled item with area-only context", () => {
    expect(placeNameVerdict("Ghibli Museum", "三鷹の森ジブリ美術館, 83, 三鷹市, 東京都, 日本", ["Mitaka", "Japan"])).toBe(
      "not-comparable",
    );
    expect(placeNameVerdict("Ghibli Museum", "Ghibli Museum Cafe, Mitaka, Tokyo, Japan", ["Mitaka", "Japan"])).toBe("match");
  });

  // Identity, not branch: the same chain in the wrong ward reads as a match.
  // Documented limitation, not a hole to close here — that is the box's job.
  it("cannot tell two branches of the same name apart", () => {
    expect(
      placeNameVerdict("Onibus Coffee", "Onibus Coffee, Setagaya, Tokyo, Setagaya, Tokyo, Japan", ["Nakameguro", "Tokyo", "Japan"]),
    ).toBe("match");
  });
});

// KI-77. Three stops of the Japan seed that the check rejected on TOKENISATION
// rather than on identity, all three the correct venue. Verbatim from the
// 2026-08-29 live LocationIQ run (the KI-58 regeneration); the queries are the
// script's own "<place>, <area>, <city>, Japan" and the display names are the
// vendor's answers, so these rows are a transcript, not a construction.
//
// Two mechanisms:
//   1. separator placement — "Nishiazabu" vs "Nishi-Azabu", "Ginkaku-ji" vs
//      "Ginkakuji" are the same name split into different tokens;
//   2. translation — "-ji" is the Japanese for the category noun "Temple",
//      which GENERIC_TOKENS already knows in English only.
describe("placeNameVerdict — KI-77 correct venues rejected on tokenisation", () => {
  const KI77: [place: string, area: string, city: string, displayName: string, stopId: string][] = [
    [
      "Gonpachi Nishiazabu",
      "Nishi-Azabu",
      "Tokyo",
      "Gonpachi Nishi-Azabu, Gaien Nishi-dori, Nishi-Azabu 1, Nishi-Azabu, Minato, Tokyo, 106-0031, Japan",
      "d1-s3-dinner-at-gonpachi",
    ],
    [
      "Tenryū-ji",
      "Arashiyama",
      "Kyoto",
      "Tenryū Temple, Saga Arashiyama Station Line, Sagatenryuji-Kitatsukurimichicho, Ukyō Ward, Kyoto, Kyoto Prefecture, 616-0000, Japan",
      "d9-s2-arashiyama-and-tenryu-ji",
    ],
    [
      "Ginkaku-ji",
      "Sakyō",
      "Kyoto",
      "Ginkakuji, Ginkakujichō, Sakyō Ward, Kyoto, Kyoto Prefecture, 606-8402, Japan",
      "d10-s1-ginkaku-ji",
    ],
  ];

  it.each(KI77)("accepts %s (%s, %s) -> %s [%s]", (place, area, city, displayName) => {
    expect(placeNameVerdict(place, displayName, [area, city, "Japan"])).toBe("match");
  });
});

// The other half of KI-77: the rejections the check MUST keep making, so that
// the fix above cannot become a false-accept generator. Every row is a real
// LocationIQ candidate from the same family of runs, and every one is the
// WRONG venue inside the right city — the class `withinBox` structurally
// cannot reject (KI-39).
describe("placeNameVerdict — KI-77 must not loosen these", () => {
  const STILL_MISMATCH: [place: string, area: string, city: string, candidateOwnName: string][] = [
    // Token equality, not substring — the reason the module's comment names.
    ["Kichi Kichi", "Pontochō", "Kyoto", "KICHIRI 河原町店"],
    ["Bread & Espresso", "Omotesandō", "Tokyo", "Cawaii Bread & Coffee"],
    ["Bread & Espresso", "Omotesandō", "Tokyo", "bricolage bread & co"],
    ["Yoshida-ya", "Arashiyama", "Kyoto", "Coffee Yoshida"],
    ["Yoshida-ya", "Arashiyama", "Kyoto", "Steak House Yoshida"],
    ["Sushi Yoshitake", "Ginza", "Tokyo", "Sushi Wasabi"],
    ["Sushi Yoshitake", "Ginza", "Tokyo", "Sushi Iwa Ginza"],
    ["Sushi Yoshitake", "Ginza", "Tokyo", "Sushi Bar Yasuda"],
    ["Kegon Falls", "Chūzenji", "Nikkō", "Urami Falls"],
    ["Kegon Falls", "Chūzenji", "Nikkō", "Furukuma Falls"],
    ["Gion Nanba", "Gion", "Kyoto", "Gion House"],
    ["Gion Nanba", "Gion", "Kyoto", "Gion Quarter"],
    ["Gion Nanba", "Gion", "Kyoto", "Gion Hanasaki"],
    ["Gion Nanba", "Gion", "Kyoto", "Gion Misen"],
    ["Gion Nanba", "Gion", "Kyoto", "GION KIMUTAKO"],
    ["Torishiki", "Meguro", "Tokyo", "MEGURO MARC"],
    ["Zentis Osaka", "Kita", "Osaka", "Hotels Inn Osaka KitaUmeda"],
    ["Zentis Osaka", "Kita", "Osaka", "M's Cort Kita Osaka"],
    ["Shin-Osaka Station", "Yodogawa", "Tokyo", "Shinagawa Station"],
    ["Shin-Osaka Station", "Yodogawa", "Tokyo", "Taito Station Shinjuku South Exit"],
    ["Hama-rikyū Gardens", "Hamamatsuchō", "Tokyo", "Tokyo, Chiyoda, Tokyo"],
  ];

  it.each(STILL_MISMATCH)("still rejects %s (%s, %s) -> %s", (place, area, city, candidate) => {
    expect(placeNameVerdict(place, `${candidate}, Japan`, [area, city, "Japan"])).toBe("mismatch");
  });
});

// The two properties the KI-77 fix rests on, stated directly rather than only
// as a consequence of the tables above.
describe("placeNameVerdict — KI-77 mechanisms", () => {
  // A run is a concatenation of WHOLE tokens, which is what keeps the
  // separator-insensitive comparison from degenerating into a substring test.
  it("joins tokens only on token boundaries, so a prefix is still not a match", () => {
    expect(placeNameVerdict("Shin", "Shinagawa Station, Minato, Tokyo, Japan", ["Minato", "Tokyo", "Japan"])).toBe("mismatch");
    expect(placeNameVerdict("Shin-Aga", "Shinagawa Station, Minato, Tokyo, Japan", ["Minato", "Tokyo", "Japan"])).toBe("mismatch");
    // …but the whole name, differently punctuated, is identity and is accepted.
    expect(placeNameVerdict("Shin-Aga-Wa", "Shinagawa, Minato, Tokyo, Japan", ["Minato", "Tokyo", "Japan"])).toBe("match");
  });

  // Documented and accepted, not accidental — see placeNameVerdict's comment.
  // Treating "-ji" as the category noun it is means "Tenryū-ji" requires only
  // "tenryu", exactly as the English spelling "Tenryū Temple" already did
  // before this change. Pinned so that the cost of the decision is visible if
  // anyone revisits it.
  it("treats a Japanese category suffix like the English category noun, including its blind spot", () => {
    const ctx = ["Arashiyama", "Kyoto", "Japan"];
    expect(placeNameVerdict("Tenryū Temple", "Tenryu Restaurant, Kyoto, Japan", ctx)).toBe("match");
    expect(placeNameVerdict("Tenryū-ji", "Tenryu Restaurant, Kyoto, Japan", ctx)).toBe("match");
    // Both spellings also agree with each other, which is the point.
    expect(placeNameVerdict("Tenryū-ji", "Tenryū Temple, Kyoto, Japan", ctx)).toBe("match");
    expect(placeNameVerdict("Tenryū Temple", "Tenryū-ji, Kyoto, Japan", ctx)).toBe("match");
  });
});

describe("the category-suffix equivalence is one-directional, deliberately", () => {
  // CodeRabbit, PR #95: `placeNameVerdict("Tenryū Temple", "Tenryuji, …")` is a
  // mismatch, because `nameTokens("Tenryuji")` is one token and `ji` never
  // reaches CATEGORY_SYNONYMS. The finding is correct and this pins it.
  //
  // NOT fixed, and the reason is reachability rather than difficulty. The only
  // importer of this module is `apps/web/scripts/geocode-japan-seed.mts`
  // (verified by grep across the repo, 2026-08-30); nothing in the product
  // calls it. That script's QUERY side is `trip.ts`'s hand-authored place
  // names, which spell these venues "Tenryū-ji" and "Ginkaku-ji" — the
  // direction that already works. For the failing direction to occur, a caller
  // would have to query the ENGLISH category form and get the separator-free
  // Japanese spelling back.
  //
  // Fixing it means stripping a category suffix off the inside of a candidate
  // token — a heuristic that necessarily over-accepts at some length ("Fuji" →
  // "Fu"). KI-77's whole lesson is that over-permissive matching is the
  // expensive direction to be wrong in, so paying that for a case no caller can
  // produce is a bad trade today.
  //
  // It stops being a bad trade the moment this module is wired into the AI
  // enrichment path (ADR-022's SearchPlaces grounding, KI-81), because a model
  // will happily emit "Tenryu Temple". Whoever does that wiring should delete
  // this test and implement the strip WITH the 21-row must-not-loosen table
  // above still passing.
  it("accepts the -ji query against an English-category candidate", () => {
    expect(placeNameVerdict("Tenryū-ji", "Tenryū Temple, Kyoto, Japan", ["Arashiyama", "Kyoto"])).toBe("match");
  });

  it("does NOT accept an English-category query against a separator-free candidate", () => {
    expect(placeNameVerdict("Tenryū Temple", "Tenryuji, Kyoto, Japan", ["Arashiyama", "Kyoto"])).toBe("mismatch");
  });
});

