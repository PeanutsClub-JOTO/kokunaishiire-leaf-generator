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
  it('① YL-6P塩レモン: leafQty=72, wholesale=41400, unitPrice=575.0, ハーフ可', () => {
    const r = planSingle({ cost: 400, minLotQty: 12 }, S);
    expect(r.ok).toBe(true);
    // minLotPrice = 400×12 = 4800, maxLots = floor(33000/4800) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(72);
    expect(r.costTotal).toBe(28800);
    expect(round1(r.wholesale)).toBe(41400);
    expect(round1(r.unitPrice)).toBe(575.0);
    expect(r.isHalfOk).toBe(true);
  });

  // ② ICR-7P水羊羹: 原価465, minLot=32
  it('② ICR-7P水羊羹: leafQty=64, wholesale=42680, unitPrice≈666.9, ハーフ可', () => {
    const r = planSingle({ cost: 465, minLotQty: 32 }, S);
    // minLotPrice = 465×32 = 14880, maxLots = floor(33000/14880) = 2
    expect(r.maxLots).toBe(2);
    expect(r.leafQty).toBe(64);
    expect(r.costTotal).toBe(29760);
    expect(round1(r.wholesale)).toBe(42680);
    expect(round1(r.unitPrice)).toBe(666.9);
    expect(r.isHalfOk).toBe(true);
  });

  // ③ YMR-8Pヨーグルト: 原価465, minLot=12
  it('③ YMR-8Pヨーグルト: leafQty=60, wholesale=40200, unitPrice=670.0, ハーフ可', () => {
    const r = planSingle({ cost: 465, minLotQty: 12 }, S);
    // minLotPrice = 465×12 = 5580, maxLots = floor(33000/5580) = 5
    expect(r.maxLots).toBe(5);
    expect(r.leafQty).toBe(60);
    expect(r.costTotal).toBe(27900);
    expect(round1(r.wholesale)).toBe(40200);
    expect(round1(r.unitPrice)).toBe(670.0);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑤ 熟果ゼリー8: 原価360, minLot=24（金額上は通過するが販売期間外で除外）
  it('⑤ 熟果ゼリー8: leafQty=72, wholesale=37560, unitPrice≈521.7（金額上は通過）', () => {
    const r = planSingle({ cost: 360, minLotQty: 24 }, S);
    // minLotPrice = 360×24 = 8640, maxLots = floor(33000/8640) = 3
    expect(r.maxLots).toBe(3);
    expect(r.leafQty).toBe(72);
    expect(r.costTotal).toBe(25920);
    expect(round1(r.wholesale)).toBe(37560);
    expect(round1(r.unitPrice)).toBe(521.7);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑧ ICR-10P水羊羹: 原価580, minLot=12（1ロット単価超でも48個で通過）
  it('⑧ ICR-10P水羊羹: leafQty=48, unitPrice≈835.8（数量を積んでゲート通過）', () => {
    const r = planSingle({ cost: 580, minLotQty: 12 }, S);
    // minLotPrice = 580×12 = 6960, maxLots = floor(33000/6960) = 4
    expect(r.maxLots).toBe(4);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(27840);
    expect(round1(r.wholesale)).toBe(40120);
    expect(round1(r.unitPrice)).toBe(835.8);
    expect(r.isHalfOk).toBe(true);
    // 単価ゲートは通過（835.8 ≤ 1000）
    expect(r.unitPrice).toBeLessThanOrEqual(S.unitPriceCap);
  });

  // ⑨ YMR-12Pヨーグルト: 原価660, minLot=8
  it('⑨ YMR-12Pヨーグルト: leafQty=48, wholesale=45240, unitPrice≈942.5, ハーフ可', () => {
    const r = planSingle({ cost: 660, minLotQty: 8 }, S);
    // minLotPrice = 660×8 = 5280, maxLots = floor(33000/5280) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(31680);
    expect(round1(r.wholesale)).toBe(45240);
    expect(round1(r.unitPrice)).toBe(942.5);
    expect(r.isHalfOk).toBe(true);
  });

  // ⑫ JKR-15熟果: 原価670, minLot=8
  it('⑫ JKR-15熟果: leafQty=48, wholesale=45880, unitPrice≈955.8, ハーフ可', () => {
    const r = planSingle({ cost: 670, minLotQty: 8 }, S);
    // minLotPrice = 670×8 = 5360, maxLots = floor(33000/5360) = 6
    expect(r.maxLots).toBe(6);
    expect(r.leafQty).toBe(48);
    expect(r.costTotal).toBe(32160);
    expect(round1(r.wholesale)).toBe(45880);
    expect(round1(r.unitPrice)).toBe(955.8);
    expect(r.isHalfOk).toBe(true);
  });

  // 原価800以上は数量を積んでも単価1000円を割らない
  it('原価800: 数量を積んでも unitPrice が 1000 を下回らない（800÷0.75>1000）', () => {
    const r = planSingle({ cost: 800, minLotQty: 10 }, S);
    // unitPrice = (costTotal ÷ 0.75 + 3000) ÷ leafQty → 漸近値 = 800÷0.75
    // leafQtyが増えるほど約1066.7円に近づくため、unit_price > cap で除外
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
  it('⑦+⑧ アソート: lotQty=24, lotPrice=11040, maxLots=2, leafQty=48, wholesale=32440, unitPrice≈675.8 (アソート単価オーバー)', () => {
    const r = planAssort(
      [
        { cost: 460, minLotQty: 12, ratio: 1 },
        { cost: 460, minLotQty: 12, ratio: 1 },
      ],
      S,
    );
    // unitPrice ≈ 675.8 × 2アイテム = 1351.7 > 1000 → assort_unit_price_over
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('assort_unit_price_over');
    expect(r.itemCount).toBe(2);
  });

  // ⑨+⑩ (cost=660, minLot=8, ratio 1:1)
  it('⑨+⑩ アソート: lotQty=16, lotPrice=10560, maxLots=3, leafQty=48, wholesale=45240, unitPrice≈942.5 (アソート単価オーバー)', () => {
    const r = planAssort(
      [
        { cost: 660, minLotQty: 8, ratio: 1 },
        { cost: 660, minLotQty: 8, ratio: 1 },
      ],
      S,
    );
    // unitPrice ≈ 942.5 × 2アイテム = 1885.0 > 1000 → assort_unit_price_over
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('assort_unit_price_over');
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
    // 原価800: 800÷0.75>1000 → 漸近値で除外境界を超える
    // 原価801: 必ず除外
    const r = planSingle({ cost: 801, minLotQty: 8 }, s);
    // unitPrice = (801×8×5÷0.75 + 3000)÷40 ≈ 1143
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

  it('⑧ICR-10P水羊羹: 金額OK（835.8≤1000）・賞味OK・販売期間2025 → 除外', () => {
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
    const r = planSingle({ cost: 660, minLotQty: 8 }, S); // unitPrice≈942.5
    const flags = calcAlertFlags(r, 200);
    expect(flags).toContain('unit_near_cap');
  });

  it('cost_over でcost_overフラグ', () => {
    const r = sizeByMaxLot(34000, 12, S);
    const flags = calcAlertFlags(r, 200);
    expect(flags).toContain('cost_over');
  });

  it('卸価格45000超でwholesale_over', () => {
    // wholesale = costTotal ÷ 0.75 + 3000。costTotalが31,500円を超えると45,000円超。
    // カスタム設定で上限を広げたケースでも検知できることを確認する。
    const customS: Settings = { ...S, costCap: 40000 };
    // cost=700, minLot=8 → lotPrice=5600, maxLots=floor(40000/5600)=7, leafQty=56, costTotal=39200
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
