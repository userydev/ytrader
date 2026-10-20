import { createElement, useLayoutEffect, useRef } from 'react';
import type { IndustryLink } from './Editorial';
import type { Article } from './types';
import './transmission.css';

type Context = { links: IndustryLink[]; title: string; eventId: string; progressId: string; returnTo: string; reports: Article[] };
export default function Transmission(context: Context) {
  const host = useRef<HTMLElement & { context?: Context }>(null);
  useLayoutEffect(() => {
    let active = true;
    // core.js is shared by both document surfaces. No model request is made.
    void customElements.whenDefined('core-transmission').then(() => { if (active && host.current) host.current.context = context; });
    return () => { active = false; };
  }, [context.links, context.title, context.eventId, context.progressId, context.returnTo, context.reports]);
  return createElement('core-transmission', { ref: host });
}
