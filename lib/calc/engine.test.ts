/**
 * 計算エンジン ユニットテスト
 *
 * §6.4 フィクスチャ（金澤兼六製菓 実データ）を全収録。
 * 今日の日付基準: 2026-05-29
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS,
  sizeByMaxLot,
  passes,
  planSingle,
  planAssort,
  calcAlertFlags,
  type Settings,
} from './engine';

const S = DEFAULT_SETTINGS;
const TODAY = new Date('2026-05-29');

// 小数第1位まで一致するか確認するヘルパー
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ============================================================
// sizeByMaxLot 基本動作
// ============================================================
describe('sizeByMaxLot', () => {
  it('1ロット価格がcostCapを超えたらcost_overを返す', () => {
    const r = sizeByMaxLot(34000, 12, S);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cost_over');
    expect(r.maxLots).toBe(0);
  });

  it('ちょうどcostCapならok=trueで最大ロット=1', () => {
    const r = sizeByMaxLot(33000, 10, S);
    expect(r.ok).toBe(true);
    expect(r.maxLots).toBe(1);
    expect(r.leafQty).toBe(10);
  });

  it('1ロット価格 <= halfBase(16500) でisHalfOk=true（仕様書§3）', () => {
    // lotPrice=16500 <= 16500 → ハーフ可
    const r = sizeByMaxLot(16500, 10, S);
    expect(r.isHalfOk).toBe(true);
  });

  it('1ロット価格 > halfBase(16500) でisHalfOk=false（仕様書§3）', () => {
    // lotPrice=16501 > 16500 → ハーフ不可
    const r = sizeByMaxLot(16501, 10, S);
    expect(r.isHalfOk).toBe(false);
  });

  it('Math.floorで切り捨て（端数が出るケース）', () => {
    // 33000 / 11000 = 3.0 → maxLots=3
    const r = sizeByMaxLot(11000, 5, S);
    expect(r.maxLots).toBe(3);
    // 33000 / 11001 = 2.999... → maxLots=2
    const r2 = sizeByMaxLot(11001, 5, S);
    expect(r2.maxLots).toBe(2);
  });
});

// ============================================================
// §6.4 フィクスチャ — 単品（金澤兼六製菓）
// ============================================================
describe('planSingle — §6.4 フィクスチャ', () => {
  // ① YL-6P塩レモン: 原価400, minLot=12
  it('① YL-6P塩レモン: leafQty=72, wholesale=39750, unitPrice≈552.1, ハーフ可', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, S);
    expect(r.ok).toBe(true);
    // minLotPrice = 400×12 = 4800, maxLots = floor(33000/4800) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(72);
    expect(r.costTotal).toBe(28800);
    expect(round1(r.wholesale)).toBe(39750);
    expect(round1(r.unitPrice)).toBe(552.1);
    expect(r.isHalfOk).toBe(true);
  });

  // ② ICR-7P水羊羹: 原価465, minLot=32
  it('② ICR-7P水羊羹: leafQty=64, wholesale=40950, unitPrice≈639.8, ハーフ可', () => {
    const r = planSingle({ cost: 465, minLotQty: 32 }, S);
    // minLotPrice = 465×32 = 14880, maxLots = floor(33000/14880) = 2
    expect(r.maxLots).toBe(2);
    expect(r.leafQty).toBe(64);
    expect(r.costTotal).toBe(29760);
    expect(round1(r.wholesale)).toBe(40950);
    expect(round1(r.unitPrice)).toBe(639.8);
    expect(r.isHalfOk).toBe(true);
  });

  // ③ YMR-8Pヨーグルト: 原価465, minLot=12
  it('③ YMR-8Pヨーグルト: leafQty=60, wholesale=38625, unitPrice≈643.8, ハーフ可', () => {
    const r = planSingle({ cost: 465, minLotQty: 12 }, S);
    // minLotPrice = 465×12 = 5580, maxLots = floor(33000/5580) = 5
    expect(r.maxLots).toBe(5);
    expect(r.leafQty).toBe(60);
    expect(r.costTotal).toBe(27900);
    expect(round1(r.wholesale)).toBe(38625);
    expect(round1(r.unitPrice)).toBe(643.8);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑤ 熟果ゼリー8: 原価360, minLot=24（金額上は通過するが販売期間外で除外）
  it('⑤ 熟果ゼリー8: leafQty=72, wholesale=36150, unitPrice≈502.1（金額上は通過）', () => {
    const r = planSingle({ cost: 360, minLotQty: 24 }, S);
    // minLotPrice = 360×24 = 8640, maxLots = floor(33000/8640) = 3
    expect(r.maxLots).toBe(3);
    expect(r.leafQty).toBe(72);
    expect(r.costTotal).toBe(25920);
    expect(round1(r.wholesale)).toBe(36150);
    expect(round1(r.unitPrice)).toBe(502.1);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑧ ICR-10P水羊羹: 原価580, minLot=12（1ロット単価超でも48個で通過）
  it('⑧ ICR-10P水羊羹: leafQty=48, unitPrice≈803.1（数量を積んでゲート通過）', () => {
    const r = planSingle({ cost: 580, minLotQty: 12 }, S);
    // minLotPrice = 580×12 = 6960, maxLots = floor(33000/6960) = 4
    expect(r.maxLots).toBe(4);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(27840);
    expect(round1(r.wholesale)).toBe(38550);
    expect(round1(r.unitPrice)).toBe(803.1);
    expect(r.isHalfOk).toBe(true);
    // 単価ゲートは通過（803.1 ≤ 1000）
    expect(r.unitPrice).toBeLessThanOrEqual(S.unitPriceCap);
  });

  // ⑨ YMR-12Pヨーグルト: 原価660, minLot=8
  it('⑨ YMR-12Pヨーグルト: leafQty=48, wholesale=43350, unitPrice≈903.1, ハーフ可', () => {
    const r = planSingle({ cost: 660, minLotQty: 8 }, S);
    // minLotPrice = 660×8 = 5280, maxLots = floor(33000/5280) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(31680);
    expect(round1(r.wholesale)).toBe(43350);
    expect(round1(r.unitPrice)).toBe(903.1);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑫ JKR-15熟果: 原価670, minLot=8
  it('⑫ JKR-15熟果: leafQty=48, wholesale=43950, unitPrice≈915.6, ハーフ可', () => {
    const r = planSingle({ cost: 670, minLotQty: 8 }, S);
    // minLotPrice = 670×8 = 5360, maxLots = floor(33000/5360) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(32160);
    expect(round1(r.wholesale)).toBe(43950);
    expect(round1(r.unitPrice)).toBe(915.6);
    expect(r.isHalfOk).toBe(true);
  });

  // 原価800以上は数量を積んでも単価1000円を割らない
  it('原価800: 数量を積んでも unitPrice が 1000 を下回らない（1.25×800=1000）', () => {
    const r = planSingle({ cost: 800, minLotQty: 10 }, S);
    // unitPrice = (costTotal + 3000) × 1.25 / leafQty → 漸近値 = 1.25×800 = 1000
    // leafQtyが増えるほど1000に近づくが超えないはずがない → 実際は超える
    // 1.25 × 800 = 1000 なので unit_price > cap で除外
    if (r.ok) {
      expect(r.unitPrice).toBeGreaterThan(S.unitPriceCap);
    }
  });
});

// ============================================================
// §6.4 フィクスチャ — アソート（金澤兼六製菓）
// ============================================================
describe('planAssort — §6.4 フィクスチャ', () => {
  // ⑥+⑦ (cost=460, minLot=12, ratio 1:1)
  it('⑥+⑦ アソート: lotQty=24, lotPrice=11040, maxLots=2, leafQty=48, wholesale=31350, unitPrice≈653.1', () => {
    const r = planAssort(
      [
        { cost: 460, minLotQty: 12, ratio: 1 },
        { cost: 460, minLotQty: 12, ratio: 1 },
      ],
      S,
    );
    expect(r.ok).toBe(true);
    // lotPrice = 460×12×1 + 460×12×1 = 11040
    expect(r.minLotPrice).toBe(11040);
    // lotQty = 12+12 = 24
    expect(r.leafQty / r.maxLots).toBe(24);
    // maxLots = floor(33000/11040) = 2
    expect(r.maxLots).toBe(2);
    expect(r.leafQty).toBe(48);
    expect(round1(r.wholesale)).toBe(31350);
    expect(round1(r.unitPrice)).toBe(653.1);
    // isHalfOk: 1ロット価格=11040 <= 16500 → true（仕様書§3。旧式 wholesale/2 では誤って false だった）
    expect(r.isHalfOk).toBe(true);
    expect(r.itemCount).toBe(2);
  });

  // ⑨+⑩ (cost=660, minLot=8, ratio 1:1)
  it('⑨+⑩ アソート: lotQty=16, lotPrice=10560, maxLots=3, leafQty=48, wholesale=43350, unitPrice≈903.1', () => {
    const r = planAssort(
      [
        { cost: 660, minLotQty: 8, ratio: 1 },
        { cost: 660, minLotQty: 8, ratio: 1 },
      ],
      S,
    );
    expect(r.ok).toBe(true);
    // lotPrice = 660×8 + 660×8 = 10560
    expect(r.minLotPrice).toBe(10560);
    expect(r.maxLots).toBe(3);
    expect(r.leafQty).toBe(48);
    expect(round1(r.wholesale)).toBe(43350);
    expect(round1(r.unitPrice)).toBe(903.1);
    expect(r.isHalfOk).toBe(true);
    expect(r.itemCount).toBe(2);
  });

  // 北辰 涼ごこち4味（cost=150, minLot=60, ×4）→ 1アソートロット36,000>33,000 除外
  it('北辰4味アソート: lotPrice=36000>33000 → cost_over除外', () => {
    const r = planAssort(
      [
        { cost: 150, minLotQty: 60, ratio: 1 },
        { cost: 150, minLotQty: 60, ratio: 1 },
        { cost: 150, minLotQty: 60, ratio: 1 },
        { cost: 150, minLotQty: 60, ratio: 1 },
      ],
      S,
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('cost_over');
    expect(r.minLotPrice).toBe(36000);
    expect(r.itemCount).toBe(4);
  });

  // 比率を変えた場合の計算確認
  it('比率2:1のアソート計算', () => {
    const r = planAssort(
      [
        { cost: 400, minLotQty: 12, ratio: 2 },
        { cost: 400, minLotQty: 12, ratio: 1 },
      ],
      S,
    );
    // lotQty = 2×12 + 1×12 = 36
    // lotPrice = 400×2×12 + 400×1×12 = 9600+4800 = 14400
    expect(r.minLotPrice).toBe(14400);
    expect(r.leafQty / r.maxLots).toBe(36);
  });
});

// ============================================================
// passes — 通過判定
// ============================================================
describe('passes', () => {
  const s: Settings = DEFAULT_SETTINGS;

  it('4条件すべて満たすと pass=true', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass } = passes(r, 200, null, null, TODAY, s);
    expect(pass).toBe(true);
  });

  it('cost_over は pass=false', () => {
    const r = sizeByMaxLot(34000, 12, s);
    const { pass, reasons } = passes(r, 200, null, null, TODAY, s);
    expect(pass).toBe(false);
    expect(reasons).toContain('max_lots<1(cost_over)');
  });

  it('単価が1000超は pass=false', () => {
    // 原価800: 1.25×800=1000 → 漸近値ちょうど1000で除外境界
    // 原価801: 必ず除外
    const r = planSingle({ cost: 801, minLotQty: 8 }, s);
    // unitPrice = (801×8×6 + 3000)×1.25 / 48 = (38448+3000)×1.25/48 ≈ 1080
    const { pass, reasons } = passes(r, 200, null, null, TODAY, s);
    if (r.ok) {
      // unitPriceが1000超なら除外
      expect(pass).toBe(false);
      expect(reasons).toContain('unit_price>cap');
    }
  });

  it('賞味期限90日未満は pass=false', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass, reasons } = passes(r, 89, null, null, TODAY, s);
    expect(pass).toBe(false);
    expect(reasons).toContain('shelf<min');
  });

  it('賞味期限ちょうど90日は pass=true（≧90で通過）', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass } = passes(r, 90, null, null, TODAY, s);
    expect(pass).toBe(true);
  });

  it('販売期間内は pass=true', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass } = passes(
      r,
      200,
      new Date('2026-04-01'),
      new Date('2026-07-31'),
      TODAY,
      s,
    );
    expect(pass).toBe(true);
  });

  it('販売期間外（過去）は pass=false', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass, reasons } = passes(
      r,
      200,
      new Date('2025-04-01'),
      new Date('2025-07-31'),
      TODAY,
      s,
    );
    expect(pass).toBe(false);
    expect(reasons).toContain('sales_out_of_range');
  });

  it('販売期間外（未来開始）は pass=false', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass, reasons } = passes(
      r,
      200,
      new Date('2026-07-01'),
      new Date('2026-09-30'),
      TODAY,
      s,
    );
    expect(pass).toBe(false);
    expect(reasons).toContain('sales_out_of_range');
  });

  it('販売期間null（未設定）は通過', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, s);
    const { pass } = passes(r, 200, null, null, TODAY, s);
    expect(pass).toBe(true);
  });

  // §6.4 の除外ケース確認
  it('⑤熟果ゼリー8: 金額OK・賞味OK・販売期間2025 → 除外', () => {
    const r = planSingle({ cost: 360, minLotQty: 24 }, s);
    const { pass, reasons } = passes(
      r,
      240,
      new Date('2025-04-01'),
      new Date('2025-09-30'),
      TODAY,
      s,
    );
    expect(pass).toBe(false);
    expect(reasons).toContain('sales_out_of_range');
  });

  it('⑧ICR-10P水羊羹: 金額OK（803.1≤1000）・賞味OK・販売期間2025 → 除外', () => {
    const r = planSingle({ cost: 580, minLotQty: 12 }, s);
    // 金額条件は通過確認
    expect(r.ok).toBe(true);
    expect(r.unitPrice).toBeLessThanOrEqual(1000);
    const { pass, reasons } = passes(
      r,
      200,
      new Date('2025-04-01'),
      new Date('2025-09-30'),
      TODAY,
      s,
    );
    expect(pass).toBe(false);
    expect(reasons).toContain('sales_out_of_range');
  });
});

// ============================================================
// calcAlertFlags
// ============================================================
describe('calcAlertFlags', () => {
  it('単価900-1000でunit_near_cap', () => {
    const r = planSingle({ cost: 660, minLotQty: 8 }, S); // unitPrice≈903.1
    const flags = calcAlertFlags(r, 200);
    expect(flags).toContain('unit_near_cap');
  });

  it('cost_over でcost_overフラグ', () => {
    const r = sizeByMaxLot(34000, 12, S);
    const flags = calcAlertFlags(r, 200);
    expect(flags).toContain('cost_over');
  });

  it('卸価格45000超でwholesale_over', () => {
    // wholesale = (costTotal + 3000) × 1.25 > 45000 → costTotal > 33000
    // 原価1000×32=32000, maxLots=1, costTotal=32000, wholesale=(32000+3000)×1.25=43750 < 45000
    // 原価1000×33=33000, maxLots=1, costTotal=33000, wholesale=(33000+3000)×1.25=45000 → ちょうど
    // 原価1001×32 → lotPrice=32032, maxLots=1, costTotal=32032, wholesale=(32032+3000)×1.25=43790 < 45000
    // 試す: cost=700, minLot=8 → lotPrice=5600, maxLots=5, leafQty=40, costTotal=28000, wholesale=(28000+3000)×1.25=38750 < 45000
    // cost=800, minLot=24 → lotPrice=19200, maxLots=1, leafQty=24, costTotal=19200, wholesale=(19200+3000)×1.25=27750 < 45000
    // 大きめのケース: cost=799, minLot=8 → lotPrice=6392, maxLots=5, leafQty=40, costTotal=31960, wholesale=(31960+3000)×1.25=43700 < 45000
    // cost=700, minLot=6 → lotPrice=4200, maxLots=7, leafQty=42, costTotal=29400, wholesale=(29400+3000)×1.25=40500 < 45000
    // cost=798, minLot=8 → lotPrice=6384, maxLots=5, leafQty=40, costTotal=31920, wholesale=(31920+3000)×1.25=43650 < 45000
    // need wholesale > 45000: (costTotal + 3000) × 1.25 > 45000 → costTotal > 33000
    // But costCap=33000, so costTotal can be at most 33000...
    // costTotal = lotPrice × maxLots ≤ costCap = 33000
    // wholesale = (33000 + 3000) × 1.25 = 45000 exactly
    // So wholesale_over (> 45000) cannot happen with default settings since costTotal ≤ costCap=33000
    // wholesale = (costTotal + salesAdd) × profitCoef ≤ (33000 + 3000) × 1.25 = 45000
    // The max is exactly 45000, so wholesale_over (> 45000) never triggers!
    // This is consistent with spec - it's a note/warning for when costTotal is close to 33000
    // Let's test with a custom setting where costCap is higher
    const customS: Settings = { ...S, costCap: 40000 };
    // cost=700, minLot=8 → lotPrice=5600, maxLots=floor(40000/5600)=7, leafQty=56, costTotal=39200, wholesale=(39200+3000)×1.25=52750 > 45000
    const r = planSingle({ cost: 700, minLotQty: 8 }, customS);
    const flags = calcAlertFlags(r, 200);
    expect(flags).toContain('wholesale_over');
  });

  it('賞味期限90以上135未満でshelf_near（shelfMinDays×1.5未満）', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, S);
    const flags = calcAlertFlags(r, 95);
    expect(flags).toContain('shelf_near');
    // 135日以上はshelf_nearにならない
    const flags2 = calcAlertFlags(r, 135);
    expect(flags2).not.toContain('shelf_near');
  });
});
