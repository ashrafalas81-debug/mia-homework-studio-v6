import type { AcademicSection, Source } from '../../shared/model';
import type { CoverInfo, DeckStyle, SlideData } from './templates';

export type Kind = 'research' | 'lab' | 'deck';

export type ResearchOptions = {
  path: 'research' | 'lab';
  topic: string;
  sourceMode: 'scientific' | 'general' | 'none';
  pages: number;
  language: 'English' | 'Arabic';
  level: string;
  citationStyle: 'APA' | 'Vancouver' | 'Harvard';
  minRefs: number;
  recentYears: number;
  extras: string[];
  instructions: string;
  labData?: string;
};

export type DeckOptions = {
  topic: string;
  content: string;
  slides: number;
  language: 'English' | 'Arabic';
  style: 'clinical' | 'modern' | 'academic' | 'bold';
  imagery: 'illustrations' | 'photos' | 'diagrams' | 'mixed';
  notes: boolean;
  audience: string;
  withSources: boolean;
  premium: boolean;
};

export type DeckTheme = { bg: string; surface: string; text: string; muted: string; accent: string; accent2: string; headingFont: string; bodyFont: string };
export type SlidePlan = { title: string; layout: string; keyMessage: string; content: string; custom: boolean };
export type SlideState = { plan: SlidePlan; data?: SlideData; custom?: boolean; html: string; notes: string; status: 'waiting' | 'working' | 'done' | 'error'; error?: string };

export type Cover = { student: string; university: string; faculty: string; course: string; professor: string; date: string };

export type Msg = { id: string; role: 'user' | 'assistant'; content: string; at: string; tone?: 'progress' | 'error' | 'success'; files?: string[]; attachments?: string[] };

/** A picture the student chose for a research section. */
export type Figure = { data: string; caption: string; credit: string; width: number; height: number };

export type V6Project = {
  id: string;
  kind: Kind;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: 'working' | 'ready' | 'error';
  progress: string;
  messages: Msg[];
  sources: Source[];
  cover: Cover;
  // research / lab
  ro?: ResearchOptions;
  outline?: { heading: string; focus: string; words: number }[];
  sections?: (AcademicSection | null)[];
  queries?: string[];
  // deck
  dk?: DeckOptions;
  theme?: DeckTheme;
  subtitle?: string;
  slides?: SlideState[];
  style?: DeckStyle;
  docStyle?: import('./docDesign').DocStyle;
  docFormat?: import('./docDesign').DocFormat;
  lastError?: string;
  coverStyle?: { nameScale: number; titleScale: number };
  /** University / faculty logo the student uploaded (data URL). */
  logo?: string;
  coverInfo?: CoverInfo;
  // undo
  history?: { label: string; sections?: (AcademicSection | null)[]; slides?: SlideState[]; style?: DeckStyle; coverInfo?: CoverInfo; extra?: Partial<V6Project> }[];
};
