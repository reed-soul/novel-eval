/**
 * 书内·质检 tab（M1）：评估（八维 Map-Reduce）与剧情逻辑审计收进书工作台。
 * 与工作台外的独立入口共用同一组件，仅预绑定本书并隐藏选源区。
 * 页签用 Radix Tabs（M1 高频控件：键盘可达 + 无障碍语义）。
 */
import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { BookTabs } from '../components/BookTabs.tsx';
import { Evaluation } from './Evaluation.tsx';
import { Audit } from './Audit.tsx';

export function BookQuality() {
  const { id: bookId = '' } = useParams();
  return (
    <div className="ab-page">
      <BookTabs active="quality" />
      <Tabs.Root defaultValue="eval" className="ab-radix-tabs">
        <Tabs.List className="ab-tabs" role="tablist" aria-label="质检工具" style={{ marginBottom: 14 }}>
          <Tabs.Trigger value="eval" className="ab-tab ab-radix-tab">
            <span className="msr msr-sm">analytics</span> 作品评估
          </Tabs.Trigger>
          <Tabs.Trigger value="audit" className="ab-tab ab-radix-tab">
            <span className="msr msr-sm">troubleshoot</span> 剧情逻辑审计
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="eval"><Evaluation bookId={bookId} /></Tabs.Content>
        <Tabs.Content value="audit"><Audit bookId={bookId} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
