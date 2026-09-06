export type BankMetric =
  | 'pages'
  | 'days'
  | 'listening'
  | 'books'
  | 'genres'
  | 'minutes'
  | 'physical'
  | 'audiobooks'
  | 'ebooks'
  | 'sessions'
  | 'long-books'
  | 'started-books';

export interface ChallengeBankTemplate {
  id: string;
  title: string;
  description: string;
  target: number;
  unit: string;
  metric: BankMetric;
  icon: 'book' | 'calendar' | 'headphones' | 'pages' | 'clock' | 'sparkles' | 'flame' | 'trophy';
}

export interface ChallengeRotationState {
  monthKey: string;
  selections: string[];
  seen: string[];
  previous: string[];
}

const make = (
  id: string,
  title: string,
  description: string,
  target: number,
  unit: string,
  metric: BankMetric,
  icon: ChallengeBankTemplate['icon'],
): ChallengeBankTemplate => ({ id, title, description, target, unit, metric, icon });

export const CHALLENGE_BANK: ChallengeBankTemplate[] = [
  make('pages-750','A Quiet 750','Read 750 tracked pages.',750,'pages','pages','pages'),
  make('pages-1000','Thousand Page Trail','Read 1,000 tracked pages.',1000,'pages','pages','pages'),
  make('pages-1250','Page Lantern','Read 1,250 tracked pages.',1250,'pages','pages','pages'),
  make('pages-1500','Page Turner','Read 1,500 tracked pages.',1500,'pages','pages','pages'),
  make('pages-1750','Between the Lines','Read 1,750 tracked pages.',1750,'pages','pages','pages'),
  make('pages-2000','Two Thousand Page Voyage','Read 2,000 tracked pages.',2000,'pages','pages','pages'),
  make('days-5','Five Reading Dates','Read on five different days.',5,'days','days','calendar'),
  make('days-7','Seven Reading Days','Read on seven different days.',7,'days','days','calendar'),
  make('days-10','Ten Days with Books','Read on ten different days.',10,'days','days','calendar'),
  make('days-12','A Dozen Reading Days','Read on twelve different days.',12,'days','days','calendar'),
  make('days-15','Half-Month Habit','Read on fifteen different days.',15,'days','days','calendar'),
  make('days-20','Twenty Days in the Pages','Read on twenty different days.',20,'days','days','calendar'),
  make('listen-120','Two Hours in Your Ears','Log two hours of audiobook listening.',120,'minutes listened','listening','headphones'),
  make('listen-180','Three Listening Hours','Log three hours of audiobook listening.',180,'minutes listened','listening','headphones'),
  make('listen-300','Listening Hours','Log five hours of audiobook listening.',300,'minutes listened','listening','headphones'),
  make('listen-420','Seven Hours of Story','Log seven hours of audiobook listening.',420,'minutes listened','listening','headphones'),
  make('listen-600','Ten Hours in Your Ears','Log ten hours of audiobook listening.',600,'minutes listened','listening','headphones'),
  make('listen-900','Audio Immersion','Log fifteen hours of audiobook listening.',900,'minutes listened','listening','headphones'),
  make('books-2','Double Feature','Finish two books.',2,'books','books','book'),
  make('books-3','Three Book Weekend','Finish three books.',3,'books','books','book'),
  make('books-4','Shelf Sweep','Finish four books.',4,'books','books','book'),
  make('books-5','Five Book Momentum','Finish five books.',5,'books','books','book'),
  make('books-6','Six Stories Strong','Finish six books.',6,'books','books','book'),
  make('books-8','Eight Book Expedition','Finish eight books.',8,'books','books','book'),
  make('genres-2','Two Worlds Apart','Finish books from two different genres.',2,'genres','genres','sparkles'),
  make('genres-3','Genre Hopper','Finish books from three different genres.',3,'genres','genres','sparkles'),
  make('genres-4','Four Corners of Fiction','Finish books from four different genres.',4,'genres','genres','sparkles'),
  make('genres-5','Genre Sampler','Finish books from five different genres.',5,'genres','genres','sparkles'),
  make('minutes-180','Three Cozy Hours','Spend three tracked hours reading.',180,'minutes','minutes','clock'),
  make('minutes-300','Five Hours Together','Spend five tracked hours reading.',300,'minutes','minutes','clock'),
  make('minutes-480','Eight Hour Escape','Spend eight tracked hours reading.',480,'minutes','minutes','clock'),
  make('minutes-600','Ten Hours Together','Spend ten tracked hours reading.',600,'minutes','minutes','clock'),
  make('minutes-900','Fifteen Hours Lost','Spend fifteen tracked hours reading.',900,'minutes','minutes','clock'),
  make('minutes-1200','Lost in the Pages','Spend twenty tracked hours reading.',1200,'minutes','minutes','clock'),
  make('physical-1','Paper in Hand','Finish one hardcover or paperback.',1,'physical book','physical','book'),
  make('physical-2','Two from the Physical Stack','Finish two hardcover or paperback books.',2,'physical books','physical','book'),
  make('physical-3','Off the Physical Stack','Finish three hardcover or paperback books.',3,'physical books','physical','book'),
  make('physical-4','Shelf to Hands','Finish four hardcover or paperback books.',4,'physical books','physical','book'),
  make('audio-books-1','Audiobook Explorer','Finish one audiobook.',1,'audiobook','audiobooks','headphones'),
  make('audio-books-2','Double Audio','Finish two audiobooks.',2,'audiobooks','audiobooks','headphones'),
  make('audio-books-3','Audio Shelf','Finish three audiobooks.',3,'audiobooks','audiobooks','headphones'),
  make('audio-books-4','Four Stories Heard','Finish four audiobooks.',4,'audiobooks','audiobooks','headphones'),
  make('ebooks-2','Digital Double','Finish two ebooks.',2,'ebooks','ebooks','book'),
  make('ebooks-3','Pocket Library','Finish three ebooks.',3,'ebooks','ebooks','book'),
  make('ebooks-4','Digital Shelf Sweep','Finish four ebooks.',4,'ebooks','ebooks','book'),
  make('ebooks-5','Five on the Screen','Finish five ebooks.',5,'ebooks','ebooks','book'),
  make('sessions-4','Four Sit-Downs','Complete four reading sessions.',4,'sessions','sessions','clock'),
  make('sessions-6','Six Reading Moments','Complete six reading sessions.',6,'sessions','sessions','clock'),
  make('sessions-8','Eight Quiet Sessions','Complete eight reading sessions.',8,'sessions','sessions','clock'),
  make('sessions-10','Ten Sessions Deep','Complete ten reading sessions.',10,'sessions','sessions','clock'),
  make('sessions-12','A Dozen Reading Moments','Complete twelve reading sessions.',12,'sessions','sessions','clock'),
  make('sessions-15','Fifteen Times Back','Complete fifteen reading sessions.',15,'sessions','sessions','clock'),
  make('long-1','Big Book Energy','Finish one book of at least 500 pages.',1,'epic book','long-books','trophy'),
  make('long-2','Two Epic Reads','Finish two books of at least 500 pages.',2,'epic books','long-books','trophy'),
  make('long-3','Chunky Book Club','Finish three books of at least 500 pages.',3,'epic books','long-books','trophy'),
  make('started-2','Fresh Starts','Start two books.',2,'books started','started-books','flame'),
  make('started-3','Reading Momentum','Start three books.',3,'books started','started-books','flame'),
  make('started-4','Four New Beginnings','Start four books.',4,'books started','started-books','flame'),
  make('started-5','Five First Chapters','Start five books.',5,'books started','started-books','flame'),
];

const hash = (value: string) => {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
};

export const buildMonthlyRotation = (
  monthKey: string,
  seen: string[] = [],
  previous: string[] = [],
  count = 3,
): ChallengeRotationState => {
  const previousSet = new Set(previous);
  const seenSet = new Set(seen);
  let candidates = CHALLENGE_BANK.filter((challenge) => !previousSet.has(challenge.id) && !seenSet.has(challenge.id));

  // The bank is intentionally large. If a very long-lived account eventually consumes it,
  // allow older ideas back into circulation while still blocking back-to-back repeats.
  if (candidates.length < count) {
    candidates = CHALLENGE_BANK.filter((challenge) => !previousSet.has(challenge.id));
  }

  const selections = [...candidates]
    .sort((a, b) => hash(`${monthKey}:${a.id}`) - hash(`${monthKey}:${b.id}`))
    .slice(0, count)
    .map((challenge) => challenge.id);

  return {
    monthKey,
    selections,
    previous: selections,
    seen: [...new Set([...seen, ...selections])],
  };
};

export const findBankTemplate = (id: string) => CHALLENGE_BANK.find((challenge) => challenge.id === id);
