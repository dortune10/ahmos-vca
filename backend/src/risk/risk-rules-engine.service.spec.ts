import { RiskRulesEngineService, RISK_BAND_SCORE } from './risk-rules-engine.service';

describe('RiskRulesEngineService', () => {
  let engine: RiskRulesEngineService;

  beforeEach(() => {
    engine = new RiskRulesEngineService();
  });

  describe('blood pressure factor', () => {
    it('marks high when systolic is exactly at the severe threshold (160)', () => {
      const result = engine.evaluate({ bpSystolic: 160, bpDiastolic: 70 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('marks high when diastolic is exactly at the severe threshold (110)', () => {
      const result = engine.evaluate({ bpSystolic: 120, bpDiastolic: 110 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('marks medium when systolic is exactly at the elevated threshold (140) but below severe', () => {
      const result = engine.evaluate({ bpSystolic: 140, bpDiastolic: 70 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks medium when diastolic is exactly at the elevated threshold (90) but below severe', () => {
      const result = engine.evaluate({ bpSystolic: 120, bpDiastolic: 90 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks low when both readings are just under the elevated thresholds', () => {
      const result = engine.evaluate({ bpSystolic: 139, bpDiastolic: 89 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('low');
    });

    it('evaluates using diastolic alone when systolic is missing', () => {
      const result = engine.evaluate({ bpDiastolic: 115 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('evaluates using systolic alone when diastolic is missing', () => {
      const result = engine.evaluate({ bpSystolic: 145 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks insufficient data (null band) when neither systolic nor diastolic is present', () => {
      const result = engine.evaluate({ hemoglobinGdl: 12 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBeNull();
    });
  });

  describe('hemoglobin factor', () => {
    it('marks high (severe anemia) when strictly below 7', () => {
      const result = engine.evaluate({ hemoglobinGdl: 6.9 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('high');
    });

    it('marks medium (anemia) at exactly 7 (7 is not < 7, but is < 11)', () => {
      const result = engine.evaluate({ hemoglobinGdl: 7 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('medium');
    });

    it('marks medium (anemia) just under 11', () => {
      const result = engine.evaluate({ hemoglobinGdl: 10.9 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('medium');
    });

    it('marks low at exactly 11 (11 is not < 11)', () => {
      const result = engine.evaluate({ hemoglobinGdl: 11 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('low');
    });

    it('marks insufficient data (null band, NOT low) when hemoglobinGdl is missing', () => {
      const result = engine.evaluate({ bpSystolic: 110 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBeNull();
    });
  });

  describe('temperature factor', () => {
    it('marks medium (possible fever) at exactly 38', () => {
      const result = engine.evaluate({ temperatureC: 38 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBe('medium');
    });

    it('marks low just under 38', () => {
      const result = engine.evaluate({ temperatureC: 37.9 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBe('low');
    });

    it('marks insufficient data (null band) when temperatureC is missing', () => {
      const result = engine.evaluate({ bpSystolic: 110 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBeNull();
    });
  });

  describe('overall aggregation (highest contributing factor wins)', () => {
    it('returns high overall when only one factor is high and the others are low', () => {
      const result = engine.evaluate({
        bpSystolic: 165,
        bpDiastolic: 70,
        hemoglobinGdl: 13,
        temperatureC: 36.5,
      });
      expect(result.band).toBe('high');
      expect(result.score).toBe(RISK_BAND_SCORE.high);
      expect(result.score).toBe(2);
    });

    it('returns medium overall when the highest contributing factor is medium', () => {
      const result = engine.evaluate({
        bpSystolic: 120,
        bpDiastolic: 70,
        hemoglobinGdl: 13,
        temperatureC: 38.5,
      });
      expect(result.band).toBe('medium');
      expect(result.score).toBe(1);
    });

    it('returns low overall when every evaluated factor is low', () => {
      const result = engine.evaluate({
        bpSystolic: 118,
        bpDiastolic: 76,
        hemoglobinGdl: 13,
        temperatureC: 36.8,
      });
      expect(result.band).toBe('low');
      expect(result.score).toBe(0);
    });

    it('ignores factors with insufficient data when picking the highest band', () => {
      const result = engine.evaluate({ hemoglobinGdl: 6 });
      expect(result.band).toBe('high');
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(bp?.band).toBeNull();
      expect(temp?.band).toBeNull();
    });

    it('defaults to low with every factor marked insufficient data when no vitals are provided at all', () => {
      const result = engine.evaluate({});
      expect(result.band).toBe('low');
      expect(result.score).toBe(0);
      expect(result.factors.every((f) => f.band === null)).toBe(true);
    });

    it('always returns exactly three factor evaluations, one per clinical input, regardless of which data is present', () => {
      const result = engine.evaluate({ bpSystolic: 150 });
      expect(result.factors.map((f) => f.factor).sort()).toEqual(
        ['bloodPressure', 'hemoglobin', 'temperature'].sort(),
      );
    });
  });
});
