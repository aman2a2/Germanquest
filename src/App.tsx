import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Bot, Brain, Check, ChevronLeft, ChevronRight, CircleHelp, Cloud, Download, Edit3, Flame, GraduationCap, History, Home, Layers3, Link2, ListFilter, LogIn, LogOut, RefreshCw, RotateCcw, Search, Settings2, Sparkles, Split, Shuffle, Star, Target, Timer, Trophy, User, X, Zap } from 'lucide-react';
import { cloudEnabled, supabase } from './lib/supabase';
import { starterWords, type VocabWord } from './lib/words';
import { generateGermanStory } from './lib/aiStory';

type Tab = 'Home' | 'Learn' | 'Play' | 'AI' | 'Progress';
type QuizType = 'topic-exam' | 'challenge';
type TopicExamSubMode = 'de-en' | 'en-de' | 'grammar' | 'match' | 'plural' | 'opposite' | 'synonym' | 'fill-blank' | 'articles';
type ChallengeSubMode = 'articles' | 'de-en' | 'en-de';
type Result = { wordId: string; correct: boolean; date: string };
type Review = { wordId: string; dueAt: string; interval: number; correctCount: number; lastCorrect?: boolean };
type ChallengeRecord = {
  id: string;
  duration: number;
  correct: number;
  wrong: number;
  total: number;
  date: string;
};

interface GeneratedStory {
  title: string;
  germanText: string;
  englishTranslation: string;
  level: string;
  topics: string[];
  wordsUsed: string[];
}

const STORE_KEY = 'wortweise-v1';
const BOOKMARKS_KEY = 'wortweise-bookmarks-v1';
const CHALLENGE_HISTORY_KEY = 'wortweise-challenge-history-v1';
const todayKey = () => new Date().toISOString().slice(0, 10);
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; } };
const readBookmarks = (): string[] => {
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]'); } catch { return []; }
};
const readChallengeHistory = (): ChallengeRecord[] => {
  try { return JSON.parse(localStorage.getItem(CHALLENGE_HISTORY_KEY) || '[]'); } catch { return []; }
};

const csvCell = (s?: string) => `"${(s || '').replaceAll('"', '""')}"`;
const exportCsv = (words: (VocabWord & { opposite?: string; synonym?: string })[]) => 
  ['german,english,topic,type,plural,opposite,synonym,example,exampleTranslation', 
   ...words.map(w => [w.german, w.english, w.topic, w.type || '', w.plural || '', w.opposite || '', w.synonym || '', w.example || '', w.exampleTranslation || ''].map(csvCell).join(','))
  ].join('\n');

const getGrammarCategory = (w: VocabWord): string => {
  const t = (w.type || '').toLowerCase();
  const g = (w.german || '').trim();
  if (g.startsWith('der ') || t.includes('masculine') || t === 'm' || t === 'maskulin') return 'Noun (Masculine / der)';
  if (g.startsWith('die ') || t.includes('feminine') || t === 'f' || t === 'feminin') return 'Noun (Feminine / die)';
  if (g.startsWith('das ') || t.includes('neuter') || t === 'n' || t === 'neutral') return 'Noun (Neuter / das)';
  if (t.includes('noun') || t === 'substantiv') return 'Noun';
  if (t.includes('verb')) return 'Verb';
  if (t.includes('adj') || t === 'adjektiv') return 'Adjective';
  if (t.includes('adv') || t === 'adverb') return 'Adverb';
  if (t.includes('plural')) return 'Plural noun';
  return 'Other';
};

const getArticleOnly = (w: VocabWord): 'der' | 'die' | 'das' | null => {
  const g = (w.german || '').trim().toLowerCase();
  if (g.startsWith('der ')) return 'der';
  if (g.startsWith('die ')) return 'die';
  if (g.startsWith('das ')) return 'das';
  const t = (w.type || '').toLowerCase();
  if (t.includes('masculine') || t === 'm' || t === 'maskulin') return 'der';
  if (t.includes('feminine') || t === 'f' || t === 'feminin') return 'die';
  if (t.includes('neuter') || t === 'n' || t === 'neutral') return 'das';
  return null;
};

const GRAMMAR_POOL = [
  'Noun (Masculine / der)',
  'Noun (Feminine / die)',
  'Noun (Neuter / das)',
  'Verb',
  'Adjective',
  'Adverb'
];

type FullVocabWord = VocabWord & { opposite?: string; synonym?: string };

export default function App() {
  const [tab, setTab] = useState<Tab>('Home');
  const [words, setWords] = useState<FullVocabWord[]>(() => {
    const s = readStore();
    return Array.isArray(s.words) && s.words.length ? s.words : starterWords;
  });
  const [results, setResults] = useState<Result[]>(() => readStore().results || []);
  const [reviews, setReviews] = useState<Record<string, Review>>(() => readStore().reviews || {});
  const [goal, setGoal] = useState<number>(() => readStore().goal || 10);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Normalized Bookmarks State
  const [bookmarkedIds, setBookmarkedIds] = useState<string[]>(() => readBookmarks().map(String));

  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');

  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState('All topics');
  const [notice, setNotice] = useState('');
  const [quizSize, setQuizSize] = useState<number>(10);

  const [quizWords, setQuizWords] = useState<FullVocabWord[]>([]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizChoice, setQuizChoice] = useState<string | null>(null);
  const [quizScore, setQuizScore] = useState(0);
  const [quizDone, setQuizDone] = useState(false);
  const [quizType, setQuizType] = useState<QuizType>('topic-exam');
  const [isPlaying, setIsPlaying] = useState(false);
  const [typedAnswer, setTypedAnswer] = useState('');

  // Challenge Mode State
  const [challengeSubMode, setChallengeSubMode] = useState<ChallengeSubMode>('articles');
  const [challengeDuration, setChallengeDuration] = useState(60);
  const [timeLeft, setTimeLeft] = useState(60);
  const [challengeTotalAnswered, setChallengeTotalAnswered] = useState(0);
  const [timeDeltaBadge, setTimeDeltaBadge] = useState<string | null>(null);
  const [challengeRecords, setChallengeRecords] = useState<ChallengeRecord[]>(readChallengeHistory);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Topic Exam Selection State
  const [selectedExamTopics, setSelectedExamTopics] = useState<string[]>([]);
  const [topicSubMode, setTopicSubMode] = useState<TopicExamSubMode>('de-en');

  // AI Story Generator States
  const [selectedAiTopics, setSelectedAiTopics] = useState<string[]>([]);
  const [aiLevel, setAiLevel] = useState<'A1' | 'A2' | 'B1' | 'B2'>('A1');
  const [aiLength, setAiLength] = useState<'Short' | 'Medium' | 'Long'>('Short');
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [currentStory, setCurrentStory] = useState<GeneratedStory | null>(null);
  const [showEnglishTranslation, setShowEnglishTranslation] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Matching game state
  const [leftWords, setLeftWords] = useState<{ id: string; text: string }[]>([]);
  const [rightWords, setRightWords] = useState<{ id: string; text: string }[]>([]);
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [selectedRight, setSelectedRight] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [wrongPair, setWrongPair] = useState<{ left: string; right: string } | null>(null);

  const [syncing, setSyncing] = useState(false);
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ words, results, reviews, goal }));
  }, [words, results, reviews, goal]);

  useEffect(() => {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarkedIds));
  }, [bookmarkedIds]);

  useEffect(() => {
    localStorage.setItem(CHALLENGE_HISTORY_KEY, JSON.stringify(challengeRecords));
  }, [challengeRecords]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email || null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setUserEmail(session?.user.email || null));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (supabase && userEmail) void syncFromCloud();
  }, [userEmail]);

  useEffect(() => {
    return () => {
      if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
      if (badgeTimer.current) clearTimeout(badgeTimer.current);
    };
  }, []);

  // Challenge Countdown Timer
  useEffect(() => {
    if (!isPlaying || quizType !== 'challenge' || quizDone) return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          finishChallenge();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, quizType, quizDone, quizScore, challengeTotalAnswered, challengeDuration]);

  const activeGameMode = useMemo(() => {
    if (quizType === 'challenge') return challengeSubMode;
    return topicSubMode;
  }, [quizType, challengeSubMode, topicSubMode]);

  // Keyboard shortcut listener for Ninja-Article mode (Keys: 1, 2, 3)
  useEffect(() => {
    if (!isPlaying || activeGameMode !== 'articles' || quizChoice) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '1') answerQuiz('der');
      else if (e.key === '2') answerQuiz('die');
      else if (e.key === '3') answerQuiz('das');
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, activeGameMode, quizChoice, quizIndex, quizWords]);

  function finishChallenge() {
    setQuizDone(true);
    const correctCount = quizScore;
    const wrongCount = Math.max(0, challengeTotalAnswered - correctCount);
    
    const newRecord: ChallengeRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      duration: challengeDuration,
      correct: correctCount,
      wrong: wrongCount,
      total: challengeTotalAnswered,
      date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })
    };

    setChallengeRecords(prev => [newRecord, ...prev].slice(0, 5));
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const rawTopics = useMemo(() => Array.from(new Set(words.map(w => w.topic))).filter(Boolean).sort(), [words]);
  const availableTopics = useMemo(() => ['★ Bookmarked', ...rawTopics], [rawTopics]);
  const topicsForFilter = useMemo(() => ['All topics', '★ Bookmarked', ...rawTopics], [rawTopics]);
  
  // Safe string-normalized bookmark lookup
  const bookmarkedWords = useMemo(() => {
    const starSet = new Set(bookmarkedIds.map(String));
    return words.filter(w => starSet.has(String(w.id)));
  }, [words, bookmarkedIds]);

  const allNouns = useMemo(() => {
    return words.filter(w => getArticleOnly(w) !== null);
  }, [words]);

  async function toggleBookmark(wordId: string | number) {
    const idStr = String(wordId);
    const isAdding = !bookmarkedIds.includes(idStr);

    setBookmarkedIds(prev =>
      isAdding ? [...prev, idStr] : prev.filter(id => id !== idStr)
    );

    if (supabase && userEmail) {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return;

        if (isAdding) {
          await supabase.from('bookmarks').upsert({
            user_id: userData.user.id,
            word_id: idStr
          });
        } else {
          await supabase.from('bookmarks')
            .delete()
            .match({ user_id: userData.user.id, word_id: idStr });
        }
      } catch (err: any) {
        console.warn('Failed to sync bookmark to Supabase:', err.message);
      }
    }
  }

  const todayResults = results.filter(r => r.date === todayKey());
  const todayLearned = new Set(todayResults.map(r => r.wordId)).size;
  const dueWords = words.filter(w => !reviews[w.id] || new Date(reviews[w.id].dueAt) <= new Date());
  const accuracy = results.length ? Math.round(results.filter(r => r.correct).length / results.length * 100) : 0;
  const mastered = words.filter(w => (reviews[w.id]?.correctCount || 0) >= 4).length;
  const weekResults = results.filter(r => Date.now() - new Date(r.date).getTime() <= 7 * 86400000);
  const recentDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d.toISOString().slice(0, 10); });

  async function syncFromCloud() {
    if (!supabase || !userEmail) {
      setNotice('Sign in to sync vocabulary and progress with Supabase.');
      return;
    }
    setSyncing(true);
    try {
      const { data: wordRows, error: wErr } = await supabase.from('vocabulary').select('*').order('created_at', { ascending: true });
      if (wErr) throw wErr;
      const { data: progressRows, error: pErr } = await supabase.from('word_progress').select('*');
      if (pErr) throw pErr;

      const { data: bookmarkRows } = await supabase.from('bookmarks').select('word_id');
      if (bookmarkRows) {
        const cloudBookmarkIds = bookmarkRows.map((r: any) => String(r.word_id));
        setBookmarkedIds(prev => Array.from(new Set([...prev, ...cloudBookmarkIds])));
      }

      const { data: userData } = await supabase.auth.getUser();

      if (wordRows?.length) {
        setWords(wordRows.map((r: any) => ({
          id: String(r.id),
          german: r.german,
          english: r.english,
          topic: r.topic || 'My vocabulary',
          type: r.type || '',
          plural: r.plural || '',
          opposite: r.opposite || '',
          synonym: r.synonym || '',
          example: r.example || '',
          exampleTranslation: r.example_translation || ''
        })));
      } else if (userData.user) {
        for (const word of words) {
          await supabase.from('vocabulary').upsert({
            id: word.id,
            user_id: userData.user.id,
            german: word.german,
            english: word.english,
            topic: word.topic,
            type: word.type || null,
            plural: word.plural || null,
            opposite: word.opposite || null,
            synonym: word.synonym || null,
            example: word.example || null,
            example_translation: word.exampleTranslation || null
          });
        }
      }

      if (progressRows?.length) {
        const next: Record<string, Review> = {};
        const syncedResults: Result[] = [];

        progressRows.forEach((r: any) => {
          next[r.word_id] = {
            wordId: r.word_id,
            dueAt: r.due_at,
            interval: r.interval_days || 1,
            correctCount: r.correct_count || 0,
            lastCorrect: r.last_correct
          };

          const updatedDate = r.updated_at ? r.updated_at.slice(0, 10) : todayKey();
          for (let i = 0; i < Math.max(1, r.correct_count || 1); i++) {
            syncedResults.push({
              wordId: r.word_id,
              correct: r.last_correct ?? true,
              date: updatedDate
            });
          }
        });

        setReviews(prev => ({ ...prev, ...next }));
        setResults(prev => prev.length >= syncedResults.length ? prev : syncedResults);
      }

      setNotice('Cloud sync active: bookmarks, progress & vocabulary updated.');
    } catch (e: any) {
      setNotice(`Cloud sync issue: ${e.message || 'check your Supabase setup'}`);
    } finally {
      setSyncing(false);
    }
  }

  async function handleAuth(e: FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setAuthMessage('Add your Supabase URL and anon key to .env.local first.');
      return;
    }
    setAuthMessage('Signing in...');
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      if (error) throw error;
      setUserEmail(data.user.email || null);
      setAuthMessage('');
      setShowAuthModal(false);
      setAuthPassword('');
      setNotice(`Welcome back, ${data.user.email}!`);
    } catch (err: any) {
      setAuthMessage(err.message || 'Invalid credentials or user does not exist.');
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setUserEmail(null);
    setNotice('Signed out. Local offline copy remains on this device.');
    setMenuOpen(false);
  }

  function record(word: FullVocabWord, correct: boolean) {
    const date = todayKey();
    setResults(prev => [...prev, { wordId: String(word.id), correct, date }]);
    setReviews(prev => {
      const old = prev[word.id] || { wordId: String(word.id), dueAt: date, interval: 0, correctCount: 0 };
      const interval = correct ? ([1, 3, 7, 14, 30][Math.min(old.correctCount, 4)] || 30) : 0;
      const due = new Date();
      due.setDate(due.getDate() + (correct ? interval : 0));
      const next = { ...old, dueAt: due.toISOString(), interval, correctCount: correct ? old.correctCount + 1 : 0, lastCorrect: correct };

      if (supabase && userEmail) {
        void (async () => {
          const { data } = await supabase.auth.getUser();
          if (!data.user) return;
          await supabase.from('word_progress').upsert({
            user_id: data.user.id,
            word_id: String(word.id),
            due_at: next.dueAt,
            interval_days: next.interval,
            correct_count: next.correctCount,
            last_correct: correct,
            updated_at: new Date().toISOString()
          });
        })();
      }
      return { ...prev, [word.id]: next };
    });
  }

  function selectMode(type: QuizType) {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    setQuizType(type);
    setIsPlaying(false);
    setQuizDone(false);
    setTypedAnswer('');
    setTab('Play');
  }

  function toggleTopicSelection(t: string) {
    if (t === '★ Bookmarked') {
      // Toggle Bookmarked exclusively to eliminate accidental bleed from other categories
      setSelectedExamTopics(prev => prev.includes('★ Bookmarked') ? [] : ['★ Bookmarked']);
      return;
    }
    // When selecting normal topics, remove '★ Bookmarked'
    setSelectedExamTopics(prev => {
      const clean = prev.filter(item => item !== '★ Bookmarked');
      return clean.includes(t) ? clean.filter(item => item !== t) : [...clean, t];
    });
  }

  function toggleAiTopicSelection(t: string) {
    setSelectedAiTopics(prev =>
      prev.includes(t) ? prev.filter(item => item !== t) : [...prev, t]
    );
  }

  // Robust, Leak-Proof Session Starter
  function startSession() {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);

    let baseWords: FullVocabWord[] = [];

    if (quizType === 'challenge') {
      if (challengeSubMode === 'articles') {
        baseWords = allNouns;
      } else {
        baseWords = words.length ? words : starterWords;
      }
    } else {
      let filtered: FullVocabWord[] = [];
      const isBookmarkSelected = selectedExamTopics.includes('★ Bookmarked');

      if (isBookmarkSelected) {
        // Enforce strict string ID matching
        const starSet = new Set(bookmarkedIds.map(String));
        filtered = words.filter(w => starSet.has(String(w.id)));

        if (!filtered.length) {
          setNotice('You do not have any bookmarked words yet. Click the ★ icon in Learn or Quiz first!');
          return;
        }
      } else if (selectedExamTopics.length > 0) {
        filtered = words.filter(w => selectedExamTopics.includes(w.topic));
      } else {
        filtered = [...words];
      }

      // Mode-specific criteria
      if (topicSubMode === 'articles') {
        filtered = filtered.filter(w => getArticleOnly(w) !== null);
      } else if (topicSubMode === 'plural') {
        filtered = filtered.filter(w => Boolean(w.plural && w.plural.trim()));
      } else if (topicSubMode === 'opposite') {
        filtered = filtered.filter(w => Boolean(w.opposite && w.opposite.trim()));
      } else if (topicSubMode === 'synonym') {
        filtered = filtered.filter(w => Boolean(w.synonym && w.synonym.trim()));
      }

      if (!filtered.length) {
        setNotice(
          isBookmarkSelected
            ? `None of your bookmarked words match the format "${topicSubMode}" (e.g., no nouns with articles).`
            : `No words found matching the format "${topicSubMode}".`
        );
        return;
      }
      baseWords = filtered;
    }

    const targetCount = quizType === 'challenge' ? Math.max(120, baseWords.length * 5) : quizSize;
    const activeWords: FullVocabWord[] = [];
    while (activeWords.length < targetCount) {
      const shuffled = [...baseWords].sort(() => Math.random() - 0.5);
      for (const w of shuffled) {
        if (activeWords.length < targetCount) {
          activeWords.push(w);
        } else {
          break;
        }
      }
    }

    setQuizWords(activeWords);
    setQuizIndex(0);
    setQuizChoice(null);
    setQuizScore(0);
    setQuizDone(false);
    setTypedAnswer('');
    setChallengeTotalAnswered(0);
    setTimeDeltaBadge(null);

    if (quizType === 'challenge') {
      setTimeLeft(challengeDuration);
    }

    if (activeGameMode === 'match') {
      initMatchingRound(activeWords);
    }

    setIsPlaying(true);
  }

  function initMatchingRound(pool: FullVocabWord[]) {
    const subset = pool.slice(0, 5);
    setLeftWords(subset.map(w => ({ id: String(w.id), text: w.german })).sort(() => Math.random() - 0.5));
    setRightWords(subset.map(w => ({ id: String(w.id), text: w.english })).sort(() => Math.random() - 0.5));
    setSelectedLeft(null);
    setSelectedRight(null);
    setMatchedIds([]);
    setWrongPair(null);
  }

  function cancelQuiz() {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    setIsPlaying(false);
    setQuizDone(false);
    setQuizChoice(null);
    setTypedAnswer('');
    setSelectedLeft(null);
    setSelectedRight(null);
    setWrongPair(null);
    setTimeDeltaBadge(null);
  }

  async function generateStoryAction() {
    setIsGeneratingStory(true);
    setShowEnglishTranslation(false);
    setNotice('');

    const starSet = new Set(bookmarkedIds.map(String));
    const candidateWords = selectedAiTopics.length
      ? words.filter(w => {
          const isStandard = selectedAiTopics.includes(w.topic);
          const isBookmarked = selectedAiTopics.includes('★ Bookmarked') && starSet.has(String(w.id));
          return isStandard || isBookmarked;
        })
      : words;

    const pickedWords = [...candidateWords]
      .sort(() => Math.random() - 0.5)
      .slice(0, 6)
      .map(w => ({ german: w.german, english: w.english }));

    try {
      const story = await generateGermanStory({
        topics: selectedAiTopics,
        level: aiLevel,
        length: aiLength,
        vocabularyWords: pickedWords
      });
      setCurrentStory(story);
    } catch (err: any) {
      setNotice(err.message || 'Could not generate story.');
    } finally {
      setIsGeneratingStory(false);
    }
  }

  const current = quizWords[quizIndex];
  const isCurrentBookmarked = current ? bookmarkedIds.includes(String(current.id)) : false;

  const promptText = useMemo(() => {
    if (!current) return '';
    if (activeGameMode === 'articles') {
      return (current.german || '').replace(/^(der|die|das)\s+/i, '');
    }
    if (activeGameMode === 'en-de' || activeGameMode === 'fill-blank') return current.english;
    if (activeGameMode === 'grammar') {
      const g = (current.german || '').trim();
      if (/^(der|die|das)\s+/i.test(g)) {
        const noun = g.replace(/^(der|die|das)\s+/i, '');
        return noun.charAt(0).toUpperCase() + noun.slice(1);
      }
      return g;
    }
    return current.german;
  }, [current, quizIndex, activeGameMode]);

  const correctAnswer = useMemo(() => {
    if (!current) return '';
    if (activeGameMode === 'articles') return getArticleOnly(current) || 'der';
    if (activeGameMode === 'de-en' || quizType === 'challenge') return current.english;
    if (activeGameMode === 'en-de' || activeGameMode === 'fill-blank') return current.german;
    if (activeGameMode === 'grammar') return getGrammarCategory(current);
    if (activeGameMode === 'plural') return current.plural || '';
    if (activeGameMode === 'opposite') return current.opposite || '';
    if (activeGameMode === 'synonym') return current.synonym || '';
    return current.english;
  }, [current, activeGameMode, quizType]);

  // Choices generation isolated to active quiz words pool
  const choices = useMemo(() => {
    if (!current || activeGameMode === 'fill-blank' || activeGameMode === 'articles') return [];
    if (activeGameMode === 'grammar') {
      const correct = getGrammarCategory(current);
      const distractors = GRAMMAR_POOL.filter(g => g !== correct).sort(() => Math.random() - 0.5).slice(0, 3);
      return [correct, ...distractors].sort(() => Math.random() - 0.5);
    }

    let key: 'english' | 'german' | 'plural' | 'opposite' | 'synonym' = 'english';
    if (activeGameMode === 'en-de') key = 'german';
    if (activeGameMode === 'plural') key = 'plural';
    if (activeGameMode === 'opposite') key = 'opposite';
    if (activeGameMode === 'synonym') key = 'synonym';

    // Prioritize active quiz words as distractors to prevent outside topic leaks
    const pool = quizWords.length >= 4
      ? quizWords.filter(w => Boolean(w[key]))
      : words.filter(w => Boolean(w[key]));

    const otherChoices = pool
      .filter(w => String(w.id) !== String(current.id) && w[key] !== current[key])
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(w => w[key] as string);

    return [current[key] as string, ...otherChoices].sort(() => Math.random() - 0.5);
  }, [current, quizIndex, words, quizWords, activeGameMode]);

  function answerQuiz(choice: string) {
    if (quizChoice || !current) return;
    setQuizChoice(choice);

    let ok = false;
    if (activeGameMode === 'articles') {
      ok = choice.toLowerCase() === correctAnswer.toLowerCase();
    } else if (activeGameMode === 'fill-blank') {
      const cleanInput = choice.trim().toLowerCase().replace(/\s+/g, ' ');
      const cleanExpected = correctAnswer.trim().toLowerCase().replace(/\s+/g, ' ');
      ok = cleanInput === cleanExpected;
    } else {
      ok = choice === correctAnswer;
    }

    if (quizType === 'challenge') {
      setChallengeTotalAnswered(prev => prev + 1);

      if (ok) {
        setQuizScore(s => s + 1);
        setTimeLeft(prev => prev + 2);
        showTimeBadge('+2s', '#10b981');
        autoNextTimer.current = setTimeout(() => {
          nextQuestion();
        }, activeGameMode === 'articles' ? 250 : 350);
      } else {
        setTimeLeft(prev => Math.max(0, prev - 5));
        showTimeBadge('-5s', '#ef4444');
        autoNextTimer.current = setTimeout(() => {
          nextQuestion();
        }, 700);
      }
    } else {
      if (ok) {
        setQuizScore(s => s + 1);
        autoNextTimer.current = setTimeout(() => {
          nextQuestion();
        }, activeGameMode === 'articles' ? 350 : 600);
      }
    }

    record(current, ok);
  }

  function showTimeBadge(text: string, _color: string) {
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    setTimeDeltaBadge(text);
    badgeTimer.current = setTimeout(() => {
      setTimeDeltaBadge(null);
    }, 700);
  }

  function nextQuestion() {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (quizType !== 'challenge' && quizIndex + 1 >= quizWords.length) {
      setQuizDone(true);
      return;
    }
    setQuizIndex(i => i + 1);
    setQuizChoice(null);
    setTypedAnswer('');
  }

  function prevQuestion() {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
    if (quizIndex > 0) {
      setQuizIndex(i => i - 1);
      setQuizChoice(null);
      setTypedAnswer('');
    }
  }

  function handleLeftClick(id: string) {
    if (matchedIds.includes(id)) return;
    setWrongPair(null);
    setSelectedLeft(id);
    if (selectedRight) {
      checkMatch(id, selectedRight);
    }
  }

  function handleRightClick(id: string) {
    if (matchedIds.includes(id)) return;
    setWrongPair(null);
    setSelectedRight(id);
    if (selectedLeft) {
      checkMatch(selectedLeft, id);
    }
  }

  function checkMatch(leftId: string, rightId: string) {
    const isMatch = leftId === rightId;
    const targetWord = words.find(w => String(w.id) === String(leftId));
    if (targetWord) record(targetWord, isMatch);

    if (isMatch) {
      setMatchedIds(prev => [...prev, leftId]);
      setSelectedLeft(null);
      setSelectedRight(null);
      setQuizScore(s => s + 1);
    } else {
      setWrongPair({ left: leftId, right: rightId });
      setTimeout(() => {
        setSelectedLeft(null);
        setSelectedRight(null);
        setWrongPair(null);
      }, 700);
    }
  }

  function triggerExportLibrary() {
    const blob = new Blob([exportCsv(words)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wortweise-vocabulary.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    setMenuOpen(false);
  }

  const filteredWords = useMemo(() => {
    const starSet = new Set(bookmarkedIds.map(String));
    return words.filter(w => {
      const matchTopic = topic === 'All topics' 
        ? true 
        : topic === '★ Bookmarked' 
        ? starSet.has(String(w.id)) 
        : w.topic === topic;
      const matchSearch = `${w.german} ${w.english} ${w.topic}`.toLowerCase().includes(search.toLowerCase());
      return matchTopic && matchSearch;
    });
  }, [words, topic, bookmarkedIds, search]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => setTab('Home')}>
          <span className="brand-mark">w.</span>
          <span>wortweise<small>GERMAN, ONE WORD AT A TIME</small></span>
        </a>
        <div className="side-label">WORKSPACE</div>
        <nav>
          {([
            { name: 'Home', icon: Home },
            { name: 'Learn', icon: BookOpen },
            { name: 'Play', icon: Layers3 },
            { name: 'AI', icon: Bot },
            { name: 'Progress', icon: Target }
          ] as const).map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}>
              <Icon size={18} />
              {name}
              {name === 'Learn' && <span className="nav-count">{words.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-chip">
            <span className={`status-dot ${cloudEnabled ? 'green' : ''}`} />
            <div>
              <strong>{cloudEnabled ? 'Cloud setup available' : 'Local preview mode'}</strong>
              <small>{userEmail || 'Configure sync in avatar menu'}</small>
            </div>
          </div>
          <button className="nav-item muted" onClick={() => setMenuOpen(prev => !prev)}>
            <Settings2 size={18} />Account & sync
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">w.</span> wortweise</div>
          <div className="breadcrumb">Workspace <ChevronRight size={14} /><strong>{tab}</strong></div>
          <div className="top-actions" style={{ position: 'relative' }} ref={menuRef}>
            <span className="streak"><Flame size={16} />{new Set(results.map(r => r.date)).size} active days</span>

            <button
              className="avatar"
              title="Account Menu"
              onClick={() => setMenuOpen(prev => !prev)}
              style={{ cursor: 'pointer', outline: menuOpen ? '2px solid var(--color-primary)' : 'none' }}
            >
              {userEmail ? userEmail[0].toUpperCase() : <User size={16} />}
            </button>

            {menuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 10px)',
                right: 0,
                width: '260px',
                backgroundColor: '#ffffff',
                borderRadius: '12px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
                border: '1px solid #e5e7eb',
                padding: '8px',
                zIndex: 100,
                color: '#1f2937',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #f3f4f6', marginBottom: '4px' }}>
                  <strong style={{ display: 'block', fontSize: '14px', wordBreak: 'break-all' }}>
                    {userEmail || 'Guest Student'}
                  </strong>
                  <small style={{ color: '#6b7280', fontSize: '12px' }}>
                    {userEmail ? 'Cloud Synced' : 'Offline / Local Mode'}
                  </small>
                </div>

                {userEmail ? (
                  <>
                    <button
                      className="nav-item"
                      style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '13px' }}
                      onClick={() => { setGoal(g => g === 10 ? 15 : g === 15 ? 20 : 10); setMenuOpen(false); }}
                    >
                      <Target size={16} /> Daily Goal: <strong>{goal} words</strong>
                    </button>
                    <button
                      className="nav-item"
                      style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '13px' }}
                      onClick={() => { void syncFromCloud(); setMenuOpen(false); }}
                    >
                      <RefreshCw size={16} /> Sync with Database
                    </button>
                    <button
                      className="nav-item"
                      style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '13px' }}
                      onClick={triggerExportLibrary}
                    >
                      <Download size={16} /> Export Words CSV
                    </button>
                    <button
                      className="nav-item"
                      style={{ width: '100%', justifyContent: 'flex-start', padding: '8px 10px', fontSize: '13px', color: '#dc2626' }}
                      onClick={() => void signOut()}
                    >
                      <LogOut size={16} /> Sign Out
                    </button>
                  </>
                ) : (
                  <button
                    className="button primary"
                    style={{ width: '100%', justifyContent: 'center', padding: '8px', fontSize: '13px', margin: '4px 0' }}
                    onClick={() => { setAuthMessage(''); setShowAuthModal(true); setMenuOpen(false); }}
                  >
                    <LogIn size={15} /> Sign In with Password
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {showHistoryModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              position: 'relative'
            }}>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="soft-icon"><History size={20} /></div>
                <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>Last 5 Challenge Records</h2>
              </div>
              <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>
                Your most recent speed challenge sessions:
              </p>

              {challengeRecords.length === 0 ? (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>
                  No games played yet. Complete a challenge to see your score history!
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {challengeRecords.map((rec, idx) => {
                    const acc = rec.total ? Math.round((rec.correct / rec.total) * 100) : 0;
                    return (
                      <div
                        key={rec.id || idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 14px',
                          borderRadius: '10px',
                          background: '#f9fafb',
                          border: '1px solid #e5e7eb'
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                            <strong style={{ fontSize: '14px' }}>⏱️ {rec.duration}s Mode</strong>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>• {rec.date}</span>
                          </div>
                          <div style={{ fontSize: '13px', display: 'flex', gap: '12px' }}>
                            <span style={{ color: '#10b981', fontWeight: 600 }}>✓ {rec.correct} correct</span>
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>✗ {rec.wrong} wrong</span>
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <strong style={{ fontSize: '16px', color: 'var(--color-primary)' }}>{rec.correct} pts</strong>
                          <div style={{ fontSize: '11px', color: '#6b7280' }}>{acc}% Acc</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {showAuthModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px'
          }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '400px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              position: 'relative'
            }}>
              <button
                onClick={() => setShowAuthModal(false)}
                style={{ position: 'absolute', top: '16px', right: '16px', border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className="soft-icon"><Cloud size={20} /></div>
                <h2 style={{ fontSize: '18px', margin: 0, fontWeight: 700 }}>
                  Sign In to Your Account
                </h2>
              </div>
              <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '16px' }}>
                Enter your credentials to load your vocabulary and cloud progress.
              </p>

              <form onSubmit={e => void handleAuth(e)} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: '#4b5563' }}>Email address</label>
                  <input
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, display: 'block', marginBottom: '4px', color: '#4b5563' }}>Password</label>
                  <input
                    type="password"
                    required
                    placeholder="••••••••"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <button className="button primary" type="submit" style={{ justifyContent: 'center', marginTop: '6px' }}>
                  <LogIn size={16} /> Sign In
                </button>
              </form>

              {authMessage && (
                <p style={{ marginTop: '12px', fontSize: '13px', textAlign: 'center', color: '#dc2626' }}>
                  {authMessage}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="page-content">
          {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
          
          {tab === 'Home' && <>
            <section className="welcome-row">
              <div>
                <div className="eyebrow">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                <h1>Guten Tag<span className="period">.</span></h1>
                <p className="subheading">A little practice today goes a long way.</p>
              </div>
              <button className="button primary" onClick={() => selectMode('topic-exam')}>
                <Sparkles size={17} /> Start Topic Exam <ChevronRight size={16} />
              </button>
            </section>
            <section className="stat-grid">
              <Stat icon={<Flame />} label="Daily streak" value={`${streakLength(results)} days`} hint="Keep your rhythm" tone="amber" />
              <Stat icon={<BookOpen />} label="Words in library" value={`${words.length}`} hint={`${rawTopics.length} topic collections`} tone="green" />
              <Stat icon={<Star />} label="Bookmarked" value={`${bookmarkedIds.length}`} hint="Synced across devices" tone="violet" />
              <Stat icon={<Trophy />} label="Accuracy" value={`${accuracy}%`} hint={`${results.length} answers recorded`} tone="blue" />
            </section>
            <section className="home-grid">
              <div className="panel daily-panel">
                <div className="panel-head">
                  <div>
                    <div className="eyebrow">YOUR DAILY GOAL</div>
                    <h2>Small steps, real progress</h2>
                  </div>
                  <span className="soft-icon"><Target size={19} /></span>
                </div>
                <div className="goal-number">
                  <strong>{Math.min(todayLearned, goal)}</strong>
                  <span> / {goal} words practiced today</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, (todayLearned / goal) * 100)}%` }} />
                </div>
                <div className="goal-footer">
                  <span>{todayLearned >= goal ? 'Daily goal complete — wunderbar!' : `${goal - todayLearned} more to reach your goal`}</span>
                  <button className="text-button" onClick={() => setGoal(g => g === 10 ? 15 : g === 15 ? 20 : 10)}>Change goal</button>
                </div>
                <div className="panel-divider" />
                <div className="section-mini-head">
                  <h3>Practice Modes</h3>
                  <span className="muted-text">Choose your training format</span>
                </div>
                <div className="practice-options">
                  <button onClick={() => selectMode('topic-exam')} className="practice-option">
                    <span className="option-icon quiz" style={{ background: '#e0e7ff', color: '#4338ca' }}><ListFilter size={19} /></span>
                    <span><strong>Topic Exam</strong><small>Choose any topic or ★ Bookmarked · 9 game formats</small></span>
                    <ChevronRight size={17} />
                  </button>
                  <button onClick={() => selectMode('challenge')} className="practice-option">
                    <span className="option-icon quiz" style={{ background: '#fef3c7', color: '#d97706' }}><Timer size={19} /></span>
                    <span><strong>Speed Challenge</strong><small>Ninja-Article & Translation countdowns · +2s / -5s</small></span>
                    <ChevronRight size={17} />
                  </button>
                  <button onClick={() => setTab('AI')} className="practice-option">
                    <span className="option-icon quiz" style={{ background: '#ede9fe', color: '#7c3aed' }}><Bot size={19} /></span>
                    <span><strong>AI Story Studio</strong><small>Generate A1-B2 stories from your words</small></span>
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="panel week-panel">
                <div className="panel-head">
                  <div>
                    <div className="eyebrow">CONSISTENCY</div>
                    <h2>This week</h2>
                  </div>
                  <span className="muted-text">Last 7 days</span>
                </div>
                <div className="week-chart">
                  {recentDays.map((d) => {
                    const count = results.filter(r => r.date === d).length;
                    return (
                      <div className="day-column" key={d}>
                        <div className="bar-zone">
                          <div className={`day-bar ${count ? 'has-value' : ''}`} style={{ height: `${Math.max(5, Math.min(100, count * 14))}%` }} title={`${count} answers`} />
                        </div>
                        <span className={d === todayKey() ? 'today-day' : ''}>{['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${d}T12:00:00`).getDay()]}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="week-summary">
                  <div><strong>{weekResults.length}</strong><span>answers this week</span></div>
                  <div><strong>{weekResults.length ? Math.round((weekResults.filter(r => r.correct).length / weekResults.length) * 100) : 0}%</strong><span>weekly accuracy</span></div>
                </div>
                <div className="tip-box">
                  <span className="tip-icon"><Star size={17} /></span>
                  <p><strong>Cloud Bookmarks</strong><br />Any word starred here or during games is instantly synced to your Supabase account.</p>
                </div>
              </div>
            </section>
          </>}

          {tab === 'Learn' && <>
            <div className="page-title-row">
              <div>
                <div className="eyebrow">YOUR PERSONAL DICTIONARY</div>
                <h1>Vocabulary<span className="period">.</span></h1>
                <p className="subheading">Synced directly with your Supabase cloud database.</p>
              </div>
              <div className="button-row">
                <button
                  className="button primary"
                  onClick={() => void syncFromCloud()}
                  disabled={syncing}
                  title="Fetch latest words and bookmarks from Supabase"
                >
                  <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync from Cloud'}
                </button>
              </div>
            </div>

            <div className="library-toolbar">
              <div className="search-box">
                <Search size={17} />
                <input placeholder="Search German or English…" value={search} onChange={e => setSearch(e.target.value)} />
                {search && <button onClick={() => setSearch('')}><X size={14} /></button>}
              </div>
              <select value={topic} onChange={e => setTopic(e.target.value)} aria-label="Filter by topic">
                {topicsForFilter.map(t => (
                  <option key={t} value={t}>
                    {t === '★ Bookmarked' ? `★ Bookmarked (${bookmarkedWords.length})` : t}
                  </option>
                ))}
              </select>
              <span className="muted-text result-count">{filteredWords.length} words</span>
            </div>

            <div className="panel vocabulary-panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>★</th>
                      <th>GERMAN</th>
                      <th>ENGLISH</th>
                      <th>TOPIC</th>
                      <th>DETAILS</th>
                      <th>REVIEW</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWords.map(w => {
                      const isStarred = bookmarkedIds.includes(String(w.id));
                      return (
                        <tr key={w.id}>
                          <td>
                            <button
                              type="button"
                              onClick={() => void toggleBookmark(w.id)}
                              title={isStarred ? 'Remove from bookmarks' : 'Bookmark this word'}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: isStarred ? '#eab308' : '#cbd5e1'
                              }}
                            >
                              <Star size={16} fill={isStarred ? '#eab308' : 'none'} strokeWidth={1.8} />
                            </button>
                          </td>
                          <td><strong className="german-word">{w.german}</strong>{w.plural && <small className="plural-label">Plural: {w.plural}</small>}</td>
                          <td>{w.english}<small className="example-line">{w.example || 'No example sentence yet'}</small></td>
                          <td><span className="topic-pill">{w.topic}</span></td>
                          <td>
                            {w.opposite && <span style={{ display: 'block', fontSize: '11px', color: '#dc2626' }}>↔ {w.opposite}</span>}
                            {w.synonym && <span style={{ display: 'block', fontSize: '11px', color: '#2563eb' }}>≈ {w.synonym}</span>}
                            {!w.opposite && !w.synonym && <span style={{ fontSize: '11px', opacity: 0.5 }}>—</span>}
                          </td>
                          <td>{reviews[w.id]?.correctCount >= 4 ? <span className="review-state learned"><Check size={13} /> Learned</span> : dueWords.some(d => String(d.id) === String(w.id)) ? <span className="review-state due">Due</span> : <span className="review-state learning">Learning</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredWords.length === 0 && (
                  <Empty
                    title={topic === '★ Bookmarked' ? 'No bookmarked words yet' : 'Your library is empty'}
                    detail={topic === '★ Bookmarked' ? 'Click the small star icon in any question or in this table to bookmark words for quick study.' : 'Add words in your Supabase database and click "Sync from Cloud".'}
                  />
                )}
              </div>
              <div className="table-footer">
                <span>Words are managed in your Supabase SQL database.</span>
                <button className="text-button" onClick={triggerExportLibrary}>Export library ↓</button>
              </div>
            </div>
          </>}

          {/* AI STUDIO TAB */}
          {tab === 'AI' && (
            <div className="page-content" style={{ padding: 0 }}>
              <div className="page-title-row">
                <div>
                  <div className="eyebrow">SMART READING ASSISTANT</div>
                  <h1>AI Story Studio<span className="period">.</span></h1>
                  <p className="subheading">Generate immersive stories based on vocabulary in your database.</p>
                </div>
              </div>

              {!currentStory ? (
                <div className="panel quiz-setup" style={{ maxWidth: '640px', margin: '0 auto', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                    <span className="large-soft-icon" style={{ background: '#ede9fe', color: '#7c3aed' }}><Bot size={26} /></span>
                    <h2 style={{ margin: 0 }}>Story Generator</h2>
                  </div>
                  <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '20px' }}>
                    Select one or more topics, choose your German difficulty level, and select the length.
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <strong style={{ fontSize: '13px', color: '#374151' }}>1. SELECT TOPICS ({selectedAiTopics.length ? `${selectedAiTopics.length} selected` : 'All Topics'})</strong>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setSelectedAiTopics([...availableTopics])}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setSelectedAiTopics([])}
                          >
                            Clear
                          </button>
                        </div>
                      </div>

                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        maxHeight: '160px',
                        overflowY: 'auto',
                        padding: '4px'
                      }}>
                        {availableTopics.map(t => {
                          const count = t === '★ Bookmarked' ? bookmarkedIds.length : words.filter(w => w.topic === t).length;
                          const isSelected = selectedAiTopics.includes(t);
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => toggleAiTopicSelection(t)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '20px',
                                border: isSelected ? '1px solid #7c3aed' : '1px solid #d1d5db',
                                background: isSelected ? '#f5f3ff' : '#ffffff',
                                color: isSelected ? '#7c3aed' : '#374151',
                                fontWeight: isSelected ? 600 : 400,
                                fontSize: '13px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                              }}
                            >
                              {isSelected && <Check size={14} />}
                              <span>{t}</span>
                              <small style={{ opacity: 0.6 }}>({count})</small>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <strong style={{ fontSize: '13px', color: '#374151', display: 'block', marginBottom: '6px' }}>2. DIFFICULTY LEVEL</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                        {(['A1', 'A2', 'B1', 'B2'] as const).map(lvl => (
                          <button
                            key={lvl}
                            type="button"
                            onClick={() => setAiLevel(lvl)}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: aiLevel === lvl ? '2px solid #7c3aed' : '1px solid #d1d5db',
                              background: aiLevel === lvl ? '#f5f3ff' : '#ffffff',
                              color: aiLevel === lvl ? '#7c3aed' : '#374151',
                              fontWeight: 700,
                              cursor: 'pointer'
                            }}
                          >
                            {lvl}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <strong style={{ fontSize: '13px', color: '#374151', display: 'block', marginBottom: '6px' }}>3. STORY LENGTH</strong>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                        {([
                          { key: 'Short', desc: '~70 words' },
                          { key: 'Medium', desc: '~140 words' },
                          { key: 'Long', desc: '~200 words' }
                        ] as const).map(len => (
                          <button
                            key={len.key}
                            type="button"
                            onClick={() => setAiLength(len.key)}
                            style={{
                              padding: '10px',
                              borderRadius: '8px',
                              border: aiLength === len.key ? '2px solid #7c3aed' : '1px solid #d1d5db',
                              background: aiLength === len.key ? '#f5f3ff' : '#ffffff',
                              color: aiLength === len.key ? '#7c3aed' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer'
                            }}
                          >
                            <div>{len.key}</div>
                            <small style={{ opacity: 0.6 }}>{len.desc}</small>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button 
                      className="button primary" 
                      onClick={generateStoryAction}
                      disabled={isGeneratingStory}
                      style={{ justifyContent: 'center', marginTop: '10px', background: '#7c3aed' }}
                    >
                      {isGeneratingStory ? <RefreshCw size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      {isGeneratingStory ? 'Creating German Story...' : 'Generate Story'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="panel" style={{ maxWidth: '680px', margin: '0 auto', textAlign: 'left', lineHeight: '1.7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="topic-pill" style={{ background: '#f5f3ff', color: '#7c3aed' }}>Level: {currentStory.level}</span>
                      {currentStory.topics.map((t, idx) => (
                        <span key={idx} className="topic-pill">{t}</span>
                      ))}
                    </div>
                    <button className="button secondary" onClick={() => setCurrentStory(null)}>
                      <X size={16} /> New Story
                    </button>
                  </div>

                  <h2 style={{ fontSize: '22px', marginBottom: '14px', color: '#111827' }}>{currentStory.title}</h2>

                  <div 
                    style={{ fontSize: '17px', color: '#1f2937', marginBottom: '24px' }}
                    dangerouslySetInnerHTML={{ __html: currentStory.germanText }} 
                  />

                  {currentStory.wordsUsed.length > 0 && (
                    <div style={{ background: '#f9fafb', padding: '12px 16px', borderRadius: '8px', marginBottom: '20px' }}>
                      <strong style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '6px' }}>KEY VOCABULARY IN STORY:</strong>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {currentStory.wordsUsed.map((w, idx) => (
                          <span key={idx} style={{ fontSize: '12px', background: '#ffffff', padding: '4px 8px', borderRadius: '4px', border: '1px solid #e5e7eb' }}>
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '20px 0' }} />

                  <div>
                    <button 
                      className="text-button" 
                      onClick={() => setShowEnglishTranslation(prev => !prev)}
                      style={{ fontWeight: 600, color: '#7c3aed', padding: 0 }}
                    >
                      {showEnglishTranslation ? 'Hide English Translation ▲' : 'Show English Translation ▼'}
                    </button>

                    {showEnglishTranslation && (
                      <p style={{ marginTop: '12px', color: '#4b5563', fontStyle: 'italic', background: '#faf5ff', padding: '14px', borderRadius: '8px', borderLeft: '3px solid #7c3aed' }}>
                        {currentStory.englishTranslation}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* PLAY TAB */}
          {tab === 'Play' && <>
            <div className="page-title-row">
              <div>
                <div className="eyebrow">PRACTICE STUDIO</div>
                <h1>Let's practice<span className="period">.</span></h1>
                <p className="subheading">Choose your mode: configure a custom Topic Exam or jump into Challenge Mode.</p>
              </div>
              <div className="mode-toggle">
                <button className={quizType === 'topic-exam' ? 'selected' : ''} onClick={() => selectMode('topic-exam')}>
                  <ListFilter size={16} /> Topic Exam
                </button>
                <button className={quizType === 'challenge' ? 'selected' : ''} onClick={() => selectMode('challenge')}>
                  <Timer size={16} /> Challenge
                </button>
              </div>
            </div>

            <div className="play-wrap">
              {!isPlaying || quizDone ? (
                <div className="panel quiz-setup">
                  <span className="large-soft-icon">
                    {quizType === 'challenge' ? <Timer size={26} /> : <ListFilter size={26} />}
                  </span>
                  <h2>
                    {quizDone 
                      ? (quizType === 'challenge' ? 'Time is up!' : 'Session complete!') 
                      : (quizType === 'challenge' ? 'Speed Challenge Mode' : 'Configure Topic Exam')}
                  </h2>
                  <p>
                    {quizDone
                      ? quizType === 'challenge'
                        ? `You answered ${quizScore} of ${challengeTotalAnswered} correctly during the countdown!`
                        : `You scored ${quizScore} / ${quizWords.length} correct (${Math.round((quizScore / Math.max(quizWords.length, 1)) * 100)}% accuracy).`
                      : quizType === 'challenge'
                      ? 'Select your challenge format and time limit. Correct answers add +2 seconds, while mistakes deduct -5 seconds!'
                      : 'Pick any topic (or ★ Bookmarked), choose your question count and quiz format, and begin.'}
                  </p>

                  {/* TOPIC EXAM SETUP CONTROLS */}
                  {!quizDone && quizType === 'topic-exam' && (
                    <div style={{ width: '100%', margin: '16px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      {/* Step 1: Multi-Topic Selection */}
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <strong style={{ fontSize: '13px', color: '#4b5563' }}>STEP 1: SELECT TOPIC(S)</strong>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setSelectedExamTopics([...rawTopics])}
                            >
                              Select All
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setSelectedExamTopics([])}
                            >
                              Clear
                            </button>
                          </div>
                        </div>

                        <div style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '8px',
                          maxHeight: '160px',
                          overflowY: 'auto',
                          padding: '4px'
                        }}>
                          {availableTopics.map(t => {
                            const count = t === '★ Bookmarked' ? bookmarkedIds.length : words.filter(w => w.topic === t).length;
                            const isSelected = selectedExamTopics.includes(t);
                            const isBookmarkTab = t === '★ Bookmarked';
                            return (
                              <button
                                key={t}
                                type="button"
                                onClick={() => toggleTopicSelection(t)}
                                style={{
                                  padding: '6px 12px',
                                  borderRadius: '20px',
                                  border: isSelected 
                                    ? isBookmarkTab ? '1px solid #eab308' : '1px solid var(--color-primary)' 
                                    : '1px solid #d1d5db',
                                  background: isSelected 
                                    ? isBookmarkTab ? '#fefce8' : 'rgba(59, 130, 246, 0.12)' 
                                    : '#ffffff',
                                  color: isSelected 
                                    ? isBookmarkTab ? '#ca8a04' : 'var(--color-primary)' 
                                    : '#374151',
                                  fontWeight: isSelected ? 600 : 400,
                                  fontSize: '13px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px'
                                }}
                              >
                                {isSelected && <Check size={14} />}
                                <span>{t}</span>
                                <small style={{ opacity: 0.6 }}>({count})</small>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Step 2: Choose Game Format */}
                      <div>
                        <strong style={{ fontSize: '13px', color: '#4b5563', display: 'block', marginBottom: '8px' }}>STEP 2: CHOOSE GAME FORMAT</strong>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setTopicSubMode('articles')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'articles' ? '2px solid #1d4ed8' : '1px solid #d1d5db',
                              background: topicSubMode === 'articles' ? '#eff6ff' : '#ffffff',
                              color: topicSubMode === 'articles' ? '#1d4ed8' : '#374151',
                              fontWeight: 700,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Zap size={16} /> Ninja-Article
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('de-en')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'de-en' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'de-en' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'de-en' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <CircleHelp size={16} /> German → English
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('en-de')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'en-de' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'en-de' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'en-de' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <CircleHelp size={16} /> English → German
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('fill-blank')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'fill-blank' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'fill-blank' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'fill-blank' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Edit3 size={16} /> Fill in the Blank
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('plural')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'plural' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'plural' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'plural' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Layers3 size={16} /> Plural Form
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('opposite')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'opposite' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'opposite' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'opposite' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Split size={16} /> Opposite (Antonym)
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('synonym')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'synonym' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'synonym' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'synonym' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Shuffle size={16} /> Synonym
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('grammar')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'grammar' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'grammar' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'grammar' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Brain size={16} /> Grammar Check
                          </button>

                          <button
                            type="button"
                            onClick={() => setTopicSubMode('match')}
                            style={{
                              padding: '10px',
                              borderRadius: '10px',
                              border: topicSubMode === 'match' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: topicSubMode === 'match' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: topicSubMode === 'match' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Link2 size={16} /> Word Match
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CHALLENGE MODE SELECTION */}
                  {!quizDone && quizType === 'challenge' && (
                    <div style={{ width: '100%', margin: '16px 0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div>
                        <strong style={{ fontSize: '13px', color: '#4b5563', display: 'block', marginBottom: '8px' }}>CHALLENGE GAME FORMAT</strong>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
                          <button
                            type="button"
                            onClick={() => setChallengeSubMode('articles')}
                            style={{
                              padding: '12px',
                              borderRadius: '10px',
                              border: challengeSubMode === 'articles' ? '2px solid #1d4ed8' : '1px solid #d1d5db',
                              background: challengeSubMode === 'articles' ? '#eff6ff' : '#ffffff',
                              color: challengeSubMode === 'articles' ? '#1d4ed8' : '#374151',
                              fontWeight: 700,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <Zap size={16} /> ⚡ Ninja-Article (Der, Die, Das)
                          </button>
                          <button
                            type="button"
                            onClick={() => setChallengeSubMode('de-en')}
                            style={{
                              padding: '12px',
                              borderRadius: '10px',
                              border: challengeSubMode === 'de-en' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: challengeSubMode === 'de-en' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: challengeSubMode === 'de-en' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <CircleHelp size={16} /> German → English
                          </button>
                          <button
                            type="button"
                            onClick={() => setChallengeSubMode('en-de')}
                            style={{
                              padding: '12px',
                              borderRadius: '10px',
                              border: challengeSubMode === 'en-de' ? '2px solid var(--color-primary)' : '1px solid #d1d5db',
                              background: challengeSubMode === 'en-de' ? 'rgba(59, 130, 246, 0.08)' : '#ffffff',
                              color: challengeSubMode === 'en-de' ? 'var(--color-primary)' : '#374151',
                              fontWeight: 600,
                              fontSize: '13px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '6px'
                            }}
                          >
                            <CircleHelp size={16} /> English → German
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {quizDone && (
                    <div className="score-ring">
                      <strong>
                        {quizType === 'challenge'
                          ? quizScore
                          : (quizWords.length ? Math.round(quizScore / Math.max(quizWords.length, 1) * 100) : 100) + '%'}
                      </strong>
                      <small>{quizType === 'challenge' ? 'SCORE' : 'ACCURACY'}</small>
                    </div>
                  )}

                  <div className="setup-controls" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                    {!quizDone && quizType === 'challenge' && (
                      <label>Countdown Duration
                        <select value={challengeDuration} onChange={e => setChallengeDuration(Number(e.target.value))}>
                          <option value={30}>30 seconds</option>
                          <option value={60}>60 seconds (1 min)</option>
                          <option value={90}>90 seconds (1.5 min)</option>
                          <option value={120}>120 seconds (2 min)</option>
                        </select>
                      </label>
                    )}

                    {!quizDone && quizType === 'topic-exam' && activeGameMode !== 'match' && (
                      <label>Number of Questions
                        <select value={quizSize} onChange={e => setQuizSize(Number(e.target.value))}>
                          <option value={5}>5 questions</option>
                          <option value={10}>10 questions</option>
                          <option value={15}>15 questions</option>
                          <option value={20}>20 questions</option>
                          <option value={30}>30 questions</option>
                        </select>
                      </label>
                    )}

                    <button
                      className="button primary"
                      onClick={startSession}
                      disabled={quizType === 'topic-exam' && !availableTopics.length}
                    >
                      <RotateCcw size={16} />{quizDone ? 'Play again' : 'Start session'} <ChevronRight size={16} />
                    </button>

                    {quizType === 'challenge' && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setShowHistoryModal(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <History size={16} /> Last 5 Games Record
                      </button>
                    )}
                  </div>
                </div>
              ) : activeGameMode === 'match' ? (
                /* MATCHING GAME VIEW */
                <div className="panel quiz-panel">
                  <div className="quiz-topline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span className="topic-pill">
                      {selectedExamTopics.includes('★ Bookmarked') ? '★ Bookmarked Match' : 'Topic Match'}
                    </span>
                    <span>{matchedIds.length} / 5 PAIRS MATCHED</span>
                    <button
                      className="button secondary"
                      style={{ padding: '6px 10px', height: 'auto', color: 'var(--color-text-muted)' }}
                      onClick={cancelQuiz}
                      title="Cancel Test"
                    >
                      <X size={16} /> Cancel
                    </button>
                  </div>

                  <div className="quiz-progress"><div style={{ width: `${(matchedIds.length / 5) * 100}%` }} /></div>

                  <div className="question-area" style={{ textAlign: 'center', marginBottom: '16px' }}>
                    <div className="eyebrow">CLICK GERMAN ON LEFT, THEN ENGLISH ON RIGHT</div>
                    <h2>Match the Words</h2>
                    <p>Correct pairs turn green. Incorrect pairs flash red.</p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', width: '100%' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {leftWords.map(item => {
                        const isMatched = matchedIds.includes(item.id);
                        const isSelected = selectedLeft === item.id;
                        const isWrong = wrongPair?.left === item.id;
                        return (
                          <button
                            key={item.id}
                            disabled={isMatched}
                            onClick={() => handleLeftClick(item.id)}
                            className={`answer-choice ${isMatched ? 'correct' : ''} ${isWrong ? 'incorrect' : ''} ${isSelected && !isMatched ? 'selected' : ''}`}
                            style={{
                              minHeight: '48px',
                              justifyContent: 'center',
                              fontWeight: 600,
                              borderColor: isSelected ? 'var(--color-primary)' : undefined,
                              background: isSelected ? 'rgba(59, 130, 246, 0.1)' : undefined
                            }}
                          >
                            {item.text}
                            {isMatched && <Check size={16} style={{ marginLeft: 6 }} />}
                          </button>
                        );
                      })}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {rightWords.map(item => {
                        const isMatched = matchedIds.includes(item.id);
                        const isSelected = selectedRight === item.id;
                        const isWrong = wrongPair?.right === item.id;
                        return (
                          <button
                            key={item.id}
                            disabled={isMatched}
                            onClick={() => handleRightClick(item.id)}
                            className={`answer-choice ${isMatched ? 'correct' : ''} ${isWrong ? 'incorrect' : ''} ${isSelected && !isMatched ? 'selected' : ''}`}
                            style={{
                              minHeight: '48px',
                              justifyContent: 'center',
                              fontWeight: 600,
                              borderColor: isSelected ? 'var(--color-primary)' : undefined,
                              background: isSelected ? 'rgba(59, 130, 246, 0.1)' : undefined
                            }}
                          >
                            {item.text}
                            {isMatched && <Check size={16} style={{ marginLeft: 6 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {matchedIds.length === 5 && (
                    <div className="answer-feedback good" style={{ marginTop: '20px' }}>
                      <strong>Ausgezeichnet! All 5 pairs matched!</strong>
                      <button className="button primary" onClick={startSession}>
                        Next Round <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </div>
              ) : activeGameMode === 'articles' ? (
                /* NINJA-ARTICLE GAME VIEW */
                <div className="panel quiz-panel" style={{ maxWidth: '520px', margin: '0 auto', textAlign: 'center' }}>
                  <div className="quiz-topline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    {quizType === 'challenge' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '18px',
                          fontWeight: 700,
                          color: timeLeft <= 10 ? '#ef4444' : 'var(--color-primary)'
                        }}>
                          <Timer size={20} className={timeLeft <= 10 ? 'animate-bounce' : ''} />
                          <span>{timeLeft}s</span>
                          {timeDeltaBadge && (
                            <span style={{
                              fontSize: '13px',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              color: '#fff',
                              backgroundColor: timeDeltaBadge.startsWith('+') ? '#10b981' : '#ef4444'
                            }}>
                              {timeDeltaBadge}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '13px', opacity: 0.8 }}>Score: <strong>{quizScore}</strong></span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          className="button secondary"
                          style={{ padding: '6px 10px', height: 'auto' }}
                          disabled={quizIndex === 0}
                          onClick={prevQuestion}
                          title="Previous Question"
                        >
                          <ChevronLeft size={16} /> Back
                        </button>
                        <span className="topic-pill">
                          {selectedExamTopics.includes('★ Bookmarked') ? '★ Bookmarked Word' : current?.topic}
                        </span>
                      </div>
                    )}

                    <span>{quizType === 'challenge' ? `WORD #${quizIndex + 1}` : `WORD ${quizIndex + 1} OF ${quizWords.length}`}</span>

                    <button
                      className="button secondary"
                      style={{ padding: '6px 10px', height: 'auto', color: 'var(--color-text-muted)' }}
                      onClick={cancelQuiz}
                      title="Cancel Drill"
                    >
                      <X size={16} /> Cancel
                    </button>
                  </div>

                  <div className="quiz-progress">
                    <div style={{
                      width: quizType === 'challenge'
                        ? `${Math.min(100, (timeLeft / challengeDuration) * 100)}%`
                        : `${((quizIndex + 1) / quizWords.length) * 100}%`,
                      backgroundColor: quizType === 'challenge' && timeLeft <= 10 ? '#ef4444' : '#1d4ed8'
                    }} />
                  </div>

                  <div className="question-area" style={{ margin: '24px 0' }}>
                    <div className="eyebrow" style={{ color: '#6b7280' }}>NINJA-ARTICLE: WHICH ARTICLE BELONGS HERE?</div>
                    
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                      <h1 style={{ fontSize: '38px', margin: '8px 0', letterSpacing: '-0.5px' }}>
                        {promptText}
                      </h1>
                      {current && (
                        <button
                          type="button"
                          onClick={() => void toggleBookmark(current.id)}
                          title={isCurrentBookmarked ? 'Starred - Click to unstar' : 'Click to star/bookmark'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isCurrentBookmarked ? '#eab308' : '#9ca3af'
                          }}
                        >
                          <Star size={20} fill={isCurrentBookmarked ? '#eab308' : 'none'} strokeWidth={2} />
                        </button>
                      )}
                    </div>

                    <p style={{ fontSize: '15px', color: '#6b7280', margin: 0 }}>
                      Meaning: <strong>{current?.english}</strong>
                    </p>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                    {([
                      { article: 'der', label: 'DER', color: '#1d4ed8', bg: '#eff6ff', key: '1' },
                      { article: 'die', label: 'DIE', color: '#b91c1c', bg: '#fef2f2', key: '2' },
                      { article: 'das', label: 'DAS', color: '#15803d', bg: '#f0fdf4', key: '3' }
                    ] as const).map(btn => {
                      const isSelected = quizChoice === btn.article;
                      const isTarget = correctAnswer === btn.article;
                      let borderStyle = `2px solid ${btn.color}`;
                      let bgStyle = btn.bg;

                      if (quizChoice) {
                        if (isTarget) {
                          bgStyle = '#dcfce7';
                          borderStyle = '2px solid #16a34a';
                        } else if (isSelected && !isTarget) {
                          bgStyle = '#fee2e2';
                          borderStyle = '2px solid #dc2626';
                        }
                      }

                      return (
                        <button
                          key={btn.article}
                          disabled={!!quizChoice}
                          onClick={() => answerQuiz(btn.article)}
                          style={{
                            padding: '18px 8px',
                            borderRadius: '12px',
                            border: borderStyle,
                            background: bgStyle,
                            color: btn.color,
                            cursor: quizChoice ? 'default' : 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <strong style={{ fontSize: '20px', fontWeight: 800 }}>{btn.label}</strong>
                          <small style={{ fontSize: '11px', opacity: 0.65 }}>Key {btn.key}</small>
                        </button>
                      );
                    })}
                  </div>

                  {quizChoice && (
                    <div style={{
                      padding: '12px',
                      borderRadius: '8px',
                      background: quizChoice.toLowerCase() === correctAnswer.toLowerCase() ? '#f0fdf4' : '#fef2f2',
                      border: `1px solid ${quizChoice.toLowerCase() === correctAnswer.toLowerCase() ? '#86efac' : '#fca5a5'}`,
                      marginTop: '8px'
                    }}>
                      <strong style={{ color: quizChoice.toLowerCase() === correctAnswer.toLowerCase() ? '#15803d' : '#b91c1c', fontSize: '15px' }}>
                        {quizChoice.toLowerCase() === correctAnswer.toLowerCase()
                          ? `✓ Richtig! ${current?.german}`
                          : `✗ Falsch — ${current?.german}`}
                        {quizType === 'challenge' && quizChoice.toLowerCase() !== correctAnswer.toLowerCase() && (
                          <span style={{ color: '#ef4444', marginLeft: '6px' }}>(-5s)</span>
                        )}
                      </strong>
                      {quizType !== 'challenge' && quizChoice.toLowerCase() !== correctAnswer.toLowerCase() && (
                        <button
                          className="button primary"
                          onClick={nextQuestion}
                          style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}
                        >
                          {quizIndex + 1 === quizWords.length ? 'See results' : 'Next Word'} <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* MULTIPLE CHOICE & FILL IN THE BLANK VIEW */
                <div className="panel quiz-panel">
                  <div className="quiz-topline" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    {quizType === 'challenge' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '18px',
                          fontWeight: 700,
                          color: timeLeft <= 10 ? '#ef4444' : 'var(--color-primary)'
                        }}>
                          <Timer size={20} className={timeLeft <= 10 ? 'animate-bounce' : ''} />
                          <span>{timeLeft}s</span>
                          {timeDeltaBadge && (
                            <span style={{
                              fontSize: '13px',
                              padding: '2px 6px',
                              borderRadius: '6px',
                              color: '#fff',
                              backgroundColor: timeDeltaBadge.startsWith('+') ? '#10b981' : '#ef4444'
                            }}>
                              {timeDeltaBadge}
                            </span>
                          )}
                        </div>
                        <span style={{ fontSize: '13px', opacity: 0.8 }}>Score: <strong>{quizScore}</strong></span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          className="button secondary"
                          style={{ padding: '6px 10px', height: 'auto' }}
                          disabled={quizIndex === 0}
                          onClick={prevQuestion}
                          title="Previous Question"
                        >
                          <ChevronLeft size={16} /> Back
                        </button>
                        <span className="topic-pill">
                          {selectedExamTopics.includes('★ Bookmarked') ? '★ Bookmarked Word' : current?.topic}
                        </span>
                      </div>
                    )}

                    <span>{quizType === 'challenge' ? `QUESTION #${quizIndex + 1}` : `QUESTION ${quizIndex + 1} OF ${quizWords.length}`}</span>

                    <button
                      className="button secondary"
                      style={{ padding: '6px 10px', height: 'auto', color: 'var(--color-text-muted)' }}
                      onClick={cancelQuiz}
                      title="Cancel Test"
                    >
                      <X size={16} /> Cancel
                    </button>
                  </div>

                  <div className="quiz-progress">
                    <div style={{
                      width: quizType === 'challenge'
                        ? `${Math.min(100, (timeLeft / challengeDuration) * 100)}%`
                        : `${((quizIndex + 1) / quizWords.length) * 100}%`,
                      backgroundColor: quizType === 'challenge' && timeLeft <= 10 ? '#ef4444' : undefined
                    }} />
                  </div>

                  <div className="question-area">
                    <div className="eyebrow">
                      {activeGameMode === 'grammar'
                        ? 'IDENTIFY THE GRAMMAR CATEGORY'
                        : activeGameMode === 'en-de'
                        ? 'CHOOSE THE GERMAN TRANSLATION'
                        : activeGameMode === 'fill-blank'
                        ? 'WRITE THE GERMAN WORD'
                        : activeGameMode === 'plural'
                        ? 'CHOOSE THE CORRECT PLURAL FORM'
                        : activeGameMode === 'opposite'
                        ? 'CHOOSE THE OPPOSITE (ANTONYM)'
                        : activeGameMode === 'synonym'
                        ? 'CHOOSE THE SYNONYM'
                        : 'CHOOSE THE ENGLISH MEANING'}
                    </div>

                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                      <h2 style={{ margin: 0 }}>{promptText}</h2>
                      {current && (
                        <button
                          type="button"
                          onClick={() => void toggleBookmark(current.id)}
                          title={isCurrentBookmarked ? 'Starred (Bookmarked) - Click to unstar' : 'Click to star/bookmark this word'}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isCurrentBookmarked ? '#eab308' : '#9ca3af',
                            transition: 'transform 0.15s ease, color 0.15s ease'
                          }}
                          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.2)')}
                          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                        >
                          <Star size={18} fill={isCurrentBookmarked ? '#eab308' : 'none'} strokeWidth={2} />
                        </button>
                      )}
                    </div>

                    {activeGameMode !== 'grammar' && current?.type && (
                      <span className="word-type" style={{ display: 'block', marginTop: '4px' }}>{current.type}</span>
                    )}

                    <p>
                      {activeGameMode === 'grammar'
                        ? 'Is this word masculine (der), feminine (die), neuter (das), a verb, or adjective?'
                        : activeGameMode === 'en-de'
                        ? 'What is the correct German word?'
                        : activeGameMode === 'fill-blank'
                        ? current?.type?.toLowerCase().includes('noun')
                          ? 'Type the full German noun including its article (der, die, or das):'
                          : 'Type the matching German word below:'
                        : activeGameMode === 'plural'
                        ? 'What is the plural form of this word?'
                        : activeGameMode === 'opposite'
                        ? 'Which German word means the exact opposite?'
                        : activeGameMode === 'synonym'
                        ? 'Which German word has a similar meaning?'
                        : 'What does this word mean in English?'}
                    </p>
                  </div>

                  {activeGameMode === 'fill-blank' ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!typedAnswer.trim()) return;
                        answerQuiz(typedAnswer.trim());
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: '100%', maxWidth: '440px', margin: '0 auto' }}
                    >
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          autoFocus
                          placeholder={current?.type?.toLowerCase().includes('noun') ? 'e.g. der Tisch' : 'Type German answer...'}
                          value={typedAnswer}
                          disabled={!!quizChoice}
                          onChange={(e) => setTypedAnswer(e.target.value)}
                          style={{
                            flex: 1,
                            padding: '12px 16px',
                            fontSize: '16px',
                            borderRadius: '8px',
                            border: '2px solid #d1d5db',
                            outline: 'none',
                            boxSizing: 'border-box'
                          }}
                        />
                        {!quizChoice && (
                          <button type="submit" className="button primary" style={{ padding: '0 20px' }}>
                            Check
                          </button>
                        )}
                      </div>

                      {!quizChoice && (
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                          {['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'].map(char => (
                            <button
                              key={char}
                              type="button"
                              onClick={() => setTypedAnswer(prev => prev + char)}
                              style={{
                                padding: '6px 12px',
                                borderRadius: '6px',
                                border: '1px solid #d1d5db',
                                background: '#f9fafb',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '14px'
                              }}
                            >
                              {char}
                            </button>
                          ))}
                        </div>
                      )}
                    </form>
                  ) : (
                    <div className="answer-list">
                      {choices.map((choice, i) => (
                        <button
                          key={`${choice}-${i}`}
                          disabled={!!quizChoice}
                          className={`answer-choice ${quizChoice && choice === correctAnswer ? 'correct' : ''} ${quizChoice === choice && choice !== correctAnswer ? 'incorrect' : ''}`}
                          onClick={() => answerQuiz(choice)}
                        >
                          <span className="choice-letter">{String.fromCharCode(65 + i)}</span>
                          <span>{choice}</span>
                          {quizChoice && choice === correctAnswer && <Check size={18} />}
                        </button>
                      ))}
                    </div>
                  )}

                  {quizChoice && (
                    <div className={`answer-feedback ${quizChoice.trim().toLowerCase() === correctAnswer.trim().toLowerCase() ? 'good' : 'bad'}`}>
                      <strong>
                        {quizChoice.trim().toLowerCase() === correctAnswer.trim().toLowerCase()
                          ? 'Ausgezeichnet! That is correct.'
                          : `Not quite — correct answer: ${correctAnswer}`}
                        {activeGameMode === 'grammar' && (
                          <span> (Full word: <em>{current?.german}</em>)</span>
                        )}
                        {quizType === 'challenge' && quizChoice.trim().toLowerCase() !== correctAnswer.trim().toLowerCase() && (
                          <span style={{ color: '#ef4444', marginLeft: '6px' }}>(-5s)</span>
                        )}
                      </strong>
                      {current?.example && (
                        <p>{current.example}<br /><span>{current.exampleTranslation}</span></p>
                      )}
                      {quizType !== 'challenge' && (
                        <button className="button primary" onClick={nextQuestion} style={{ marginTop: '10px' }}>
                          {quizIndex + 1 === quizWords.length ? 'See results' : 'Continue'} <ChevronRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>}

          {tab === 'Progress' && <>
            <div className="page-title-row">
              <div>
                <div className="eyebrow">YOUR LEARNING JOURNEY</div>
                <h1>Progress<span className="period">.</span></h1>
                <p className="subheading">Consistency beats cramming. Look how far you've come.</p>
              </div>
              <button className="button secondary" onClick={() => setNotice('Progress is saved automatically on this device.')}>
                <Target size={16} /> All-time overview
              </button>
            </div>
            <section className="stat-grid progress-stats">
              <Stat icon={<BookOpen />} label="In your library" value={`${words.length}`} hint="Across all topics" tone="green" />
              <Stat icon={<Check />} label="Mastered" value={`${mastered}`} hint="Correct repeatedly" tone="blue" />
              <Stat icon={<Brain />} label="Answers recorded" value={`${results.length}`} hint={`${weekResults.length} in the last 7 days`} tone="violet" />
              <Stat icon={<Target />} label="Overall accuracy" value={`${accuracy}%`} hint="Across all attempts" tone="amber" />
            </section>
            <div className="panel progress-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">PRACTICE HISTORY</div>
                  <h2>Your last 7 days</h2>
                </div>
              </div>
              <div className="history-list">
                {recentDays.slice().reverse().map(d => {
                  const day = results.filter(r => r.date === d);
                  const pct = day.length ? Math.round((day.filter(r => r.correct).length / day.length) * 100) : 0;
                  return (
                    <div className="history-row" key={d}>
                      <div className="history-date">
                        <strong>{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })}</strong>
                        <small>{new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
                      </div>
                      <div className="history-bar"><div style={{ width: `${pct}%` }} /></div>
                      <div className="history-score">{day.length ? `${pct}%` : '—'}</div>
                      <div className="history-count">{day.length} answers</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="panel progress-panel">
              <div className="panel-head">
                <div>
                  <div className="eyebrow">TOPIC BREAKDOWN</div>
                  <h2>Where you're learning</h2>
                </div>
              </div>
              <div className="topic-progress-list">
                {rawTopics.map(t => {
                  const group = words.filter(w => w.topic === t);
                  const learned = group.filter(w => (reviews[w.id]?.correctCount || 0) >= 4).length;
                  return (
                    <div className="topic-progress-row" key={t}>
                      <div><strong>{t}</strong><small>{learned} of {group.length} mastered</small></div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${group.length ? (learned / group.length) * 100 : 0}%` }} /></div>
                      <span>{group.length ? Math.round((learned / group.length) * 100) : 0}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>}

          <footer>
            <span>wortweise <span className="period">·</span> Your German, one word at a time.</span>
            <span>{syncing ? 'Syncing…' : cloudEnabled && userEmail ? 'Cloud enabled' : 'Local data saved in this browser'}</span>
          </footer>
        </div>

        <nav className="mobile-bottom-nav">
          {([
            { name: 'Home', icon: Home },
            { name: 'Learn', icon: BookOpen },
            { name: 'Play', icon: Layers3 },
            { name: 'AI', icon: Bot },
            { name: 'Progress', icon: Target }
          ] as const).map(({ name, icon: Icon }) => (
            <button
              key={name}
              type="button"
              className={`mobile-nav-btn ${tab === name ? 'active' : ''}`}
              onClick={() => setTab(name)}
            >
              <Icon size={20} />
              <span>{name}</span>
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}

function Stat({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: string; hint: string; tone: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-hint">{hint}</span>
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <BookOpen size={26} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

function streakLength(results: Result[]) {
  const days = new Set(results.map(r => r.date));
  let n = 0;
  const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  while (days.has(d.toISOString().slice(0, 10))) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}