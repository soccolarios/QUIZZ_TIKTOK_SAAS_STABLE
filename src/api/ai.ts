import { api } from './client';
import type { QuizQuestion } from './types';

export interface GenerateRequest {
  theme: string;
  difficulty: 1 | 2 | 3;
  question_count: number;
  language: string;
  audience: string;
  style: string;
  category?: string;
}

export interface GenerateResponse {
  theme: string;
  difficulty: number;
  language: string;
  question_count: number;
  questions: QuizQuestion[];
}

export const aiApi = {
  generate: (req: GenerateRequest) =>
    api.post<GenerateResponse>('/api/ai/generate', req),
};
