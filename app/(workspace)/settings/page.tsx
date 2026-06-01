'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Save, Settings as SettingsIcon } from 'lucide-react';
import { useData } from '@/lib/data-context';
import { useAuth } from '@/lib/auth-context';
import { Card, CardHeader, CardBody } from '@/components/Card';
import { Button } from '@/components/Button';
import { ManagerSettings } from '@/components/ManagerSettings';
import { AccountSettings } from '@/components/AccountSettings';
import { saveConfig, writeAudit } from '@/lib/data';
import { fmtDate } from '@/lib/utils';
import type { Config } from '@/lib/types';

export default function SettingsPage() {
  const { config, today } = useData();
  const { user } = useAuth();
  const [draft, setDraft] = useState<Config>(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => setDraft(config), [config]);

  const change = <K extends keyof Config>(k: K, v: Config[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await saveConfig(draft);
      await writeAudit({
        actor: user?.email || 'unknown',
        type: 'config_update',
        target: 'main',
        memo: '운영 정책 변경',
        at: fmtDate(today),
      });
      toast.success('저장 완료. 모든 화면에 즉시 반영');
    } catch (e: any) {
      toast.error(e?.message || '실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">단지 설정</h1>
          <p className="text-[12.5px] text-zinc-500 mt-0.5">
            모든 운영 룰은 여기서 조정. 단지마다·시기마다 자유롭게.
          </p>
        </div>
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save className="w-3.5 h-3.5" /> {saving ? '저장 중...' : '저장'}
        </Button>
      </div>

      <AccountSettings />

      <ManagerSettings />

      <Card>
        <CardHeader title="단지 구조" desc="단일 건물 또는 다동 단지 — 도면 만들기 화면 흐름에 반영" />
        <CardBody>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => change('complex_layout', 'single')}
              className={`p-4 rounded-lg border-2 text-left transition ${
                draft.complex_layout === 'single'
                  ? 'border-zinc-900 bg-zinc-50'
                  : 'border-zinc-200 hover:border-zinc-400'
              }`}
            >
              <div className="font-bold text-[13px] mb-1">🏢 단일 건물</div>
              <div className="text-[11.5px] text-zinc-500 leading-snug">
                동 구분 없이 층만 관리. 새 층 만들 때 동 입력 X.
              </div>
            </button>
            <button
              onClick={() => change('complex_layout', 'multi')}
              className={`p-4 rounded-lg border-2 text-left transition ${
                draft.complex_layout === 'multi'
                  ? 'border-zinc-900 bg-zinc-50'
                  : 'border-zinc-200 hover:border-zinc-400'
              }`}
            >
              <div className="font-bold text-[13px] mb-1">🏢🏢 다동 단지</div>
              <div className="text-[11.5px] text-zinc-500 leading-snug">
                A동·B동·C동... 여러 건물. 새 층 만들 때 동을 선택하거나 새로 만듦.
              </div>
            </button>
          </div>
          {draft.complex_layout === 'single' && (
            <div className="mt-3">
              <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
                단일 건물 표시 이름
              </label>
              <input
                type="text"
                value={draft.single_building_label}
                onChange={(e) => change('single_building_label', e.target.value)}
                placeholder="예: 본관, 메인, 사옥"
                className="w-full md:w-1/2 border border-zinc-200 rounded-md px-3 py-1.5 text-[13px]"
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="청구·납기" />
        <CardBody className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <NumField
            label="정기 청구 생성일 (매월)"
            value={draft.billing_day}
            onChange={(v) => change('billing_day', v)}
          />
          <NumField
            label="청구서 발송일"
            value={draft.sending_day}
            onChange={(v) => change('sending_day', v)}
          />
          <NumField
            label="납기일"
            value={draft.due_day}
            onChange={(v) => change('due_day', v)}
          />
          <SelField
            label="연체료 산식"
            value={draft.late_fee}
            options={[
              ['daily', '일할'],
              ['monthly', '월할'],
              ['none', '면제'],
            ]}
            onChange={(v) => change('late_fee', v as Config['late_fee'])}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="상태 임계값" />
        <CardBody className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumField
            label="만료예정 기준 (일)"
            value={draft.expiring_threshold_days}
            onChange={(v) => change('expiring_threshold_days', v)}
          />
          <NumField
            label="연체 시작 기준 (납기 +일)"
            value={draft.overdue_threshold_days}
            onChange={(v) => change('overdue_threshold_days', v)}
          />
          <TextField
            label="미수 연령 분류 (콤마)"
            value={draft.receivable_aging.join(',')}
            onChange={(v) =>
              change(
                'receivable_aging',
                v
                  .split(',')
                  .map((x) => parseInt(x.trim()))
                  .filter((x) => !isNaN(x))
              )
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="계약 정책" />
        <CardBody className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <NumField
            label="보증금 = 월세 × N개월"
            value={draft.deposit_multiplier}
            step={0.5}
            onChange={(v) => change('deposit_multiplier', v)}
          />
          <NumField
            label="갱신 시 인상률 (소수, 0.05=5%)"
            value={draft.renewal_increase_rate}
            step={0.01}
            onChange={(v) => change('renewal_increase_rate', v)}
          />
          <SelField
            label="공과금 안분 방식"
            value={draft.allocation_method}
            options={[
              ['area', '면적비'],
              ['days', '점유 일수'],
              ['equal', '균등'],
              ['meter', '개별 검침'],
            ]}
            onChange={(v) =>
              change('allocation_method', v as Config['allocation_method'])
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="알림·계좌" />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="만료 사전 알림 (일, 콤마)"
            value={draft.notification_pre_expire.join(',')}
            onChange={(v) =>
              change(
                'notification_pre_expire',
                v
                  .split(',')
                  .map((x) => parseInt(x.trim()))
                  .filter((x) => !isNaN(x))
              )
            }
          />
          <TextField
            label="연체 사후 알림 (일, 콤마)"
            value={draft.notification_after_due.join(',')}
            onChange={(v) =>
              change(
                'notification_after_due',
                v
                  .split(',')
                  .map((x) => parseInt(x.trim()))
                  .filter((x) => !isNaN(x))
              )
            }
          />
          <TextField
            label="알림 발신자"
            value={draft.notify_sender}
            onChange={(v) => change('notify_sender', v)}
          />
          <TextField
            label="입금 계좌"
            value={draft.account}
            onChange={(v) => change('account', v)}
          />
        </CardBody>
      </Card>

      <div className="text-[11.5px] text-zinc-500 flex items-center gap-1.5">
        <SettingsIcon className="w-3 h-3" />
        본 정책은 모든 화면(상태 산출·청구·알림)에 즉시 반영됩니다.
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
        {label}
      </label>
      <input
        type="number"
        value={value}
        step={step || 1}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] tabular focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:border-zinc-500"
      />
    </div>
  );
}

function SelField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-semibold text-zinc-600 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-zinc-200 rounded-md px-3 py-1.5 text-[13px] bg-white focus:outline-none focus:border-zinc-500"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}
