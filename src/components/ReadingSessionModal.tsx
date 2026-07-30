import React, { useState, useEffect } from 'react';
import { UserBookRecord, ReadingSession } from '../types';
import { BookCover } from './BookCover';
import {
  X,
  Play,
  Pause,
  Square,
  Clock,
  Sparkles,
  MapPin,
  Smile,
  FileText,
  CheckCircle2
} from 'lucide-react';

interface ReadingSessionModalProps {
  books: UserBookRecord[];
  initialBookId?: string;
  onClose: () => void;
  onSaveSession: (session: ReadingSession, updatedProgressPages: number, updatedProgressMins: number) => void;
}

export const ReadingSessionModal: React.FC<ReadingSessionModalProps> = ({
  books,
  initialBookId,
  onClose,
  onSaveSession,
}) => {
  const readingBooks = books.filter((b) => b.status === 'currently-reading' || b.status === 'tbr');
  const [selectedBookId, setSelectedBookId] = useState<string>(
    initialBookId || (readingBooks[0]?.id || books[0]?.id || '')
  );

  const selectedBook = books.find((b) => b.id === selectedBookId) || books[0];
  const activeEdition = selectedBook?.editions.find((e) => e.id === selectedBook.activeEditionId) || selectedBook?.editions[0];
  const isAudiobook = activeEdition?.format === 'audiobook';

  // Timer State
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  // Form Inputs
  const [startPage, setStartPage] = useState(selectedBook?.progressPages || 0);
  const [endPage, setEndPage] = useState((selectedBook?.progressPages || 0) + 20);

  const [startMins, setStartMins] = useState(selectedBook?.progressMinutes || 0);
  const [endMins, setEndMins] = useState((selectedBook?.progressMinutes || 0) + 30);
  const [listeningSpeed, setListeningSpeed] = useState(1.2);

  const [notes, setNotes] = useState('');
  const [mood, setMood] = useState('Atmospheric');
  const [location, setLocation] = useState('Cozy Armchair');

  // Live Timer Interval
  useEffect(() => {
    let interval: any = null;
    if (isActive) {
      interval = setInterval(() => {
        setTimerSeconds((prev) => prev + 1);
      }, 1000);
    } else if (!isActive && timerSeconds !== 0) {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isActive, timerSeconds]);

  // Format MM:SS or HH:MM:SS
  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleFinishSession = () => {
    setIsActive(false);
    setIsFinished(true);
  };

  const handleSaveAndClose = () => {
    const sessionDurationMins = Math.max(1, Math.round(timerSeconds / 60));
    const pagesCompleted = Math.max(0, endPage - startPage);
    const minsCompleted = Math.max(0, endMins - startMins);

    const session: ReadingSession = {
      id: 'sess-' + Date.now(),
      bookId: selectedBook.id,
      date: new Date().toISOString().split('T')[0],
      startTime: new Date(Date.now() - sessionDurationMins * 60000).toTimeString().substring(0, 5),
      endTime: new Date().toTimeString().substring(0, 5),
      durationMinutes: sessionDurationMins,
      startPage: !isAudiobook ? startPage : undefined,
      endPage: !isAudiobook ? endPage : undefined,
      pagesRead: !isAudiobook ? pagesCompleted : undefined,
      startTimestampSec: isAudiobook ? startMins * 60 : undefined,
      endTimestampSec: isAudiobook ? endMins * 60 : undefined,
      minutesListened: isAudiobook ? minsCompleted : undefined,
      listeningSpeed: isAudiobook ? listeningSpeed : undefined,
      notes: notes.trim() || undefined,
      mood,
      location,
    };

    onSaveSession(session, !isAudiobook ? endPage : startPage, isAudiobook ? endMins : startMins);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1c0f24] border border-[#c5a059]/40 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative">
        
        <button onClick={onClose} className="absolute top-4 right-4 text-stone-400 hover:text-white p-1 rounded-full bg-black/30 hover:bg-black/50 transition">
          <X className="w-5 h-5" />
        </button>

        {/* Header Title */}
        <div className="text-center space-y-1">
          <Clock className="w-8 h-8 text-[#e5c158] mx-auto animate-pulse" />
          <h3 className="font-serif font-bold text-2xl text-[#f4efe6]">
            Reading Session Companion
          </h3>
          <p className="text-xs text-stone-300">
            Track your reading focus and immersion metrics
          </p>
        </div>

        {/* Book Selector */}
        {!isFinished && (
          <div>
            <label className="text-xs font-bold text-[#f4efe6] block mb-1">
              Select Book
            </label>
            <select
              value={selectedBookId}
              onChange={(e) => {
                setSelectedBookId(e.target.value);
                const b = books.find((x) => x.id === e.target.value);
                if (b) {
                  setStartPage(b.progressPages);
                  setEndPage(b.progressPages + 20);
                }
              }}
              className="w-full p-2.5 rounded-xl text-xs bg-[#120817] border border-[#3d2448] text-[#f4efe6] font-medium focus:outline-none focus:border-[#c5a059]"
            >
              {readingBooks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.work.title} ({b.work.author})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* TIMER DISPLAY */}
        {!isFinished ? (
          <div className="bg-[#25132f] text-[#f4efe6] p-6 rounded-2xl text-center space-y-4 shadow-inner border border-[#c5a059]/30">
            <div className="font-serif text-5xl font-bold tracking-widest text-[#e5c158] font-mono">
              {formatTime(timerSeconds)}
            </div>
            <p className="text-xs text-stone-300">
              {isActive ? 'Session in progress...' : timerSeconds > 0 ? 'Paused' : 'Ready to start'}
            </p>

            {/* Timer Controls */}
            <div className="flex justify-center items-center gap-4 pt-2">
              {!isActive ? (
                <button
                  onClick={() => setIsActive(true)}
                  className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs shadow-md hover:opacity-95 flex items-center gap-2 transition"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{timerSeconds === 0 ? 'Start Timer' : 'Resume'}</span>
                </button>
              ) : (
                <button
                  onClick={() => setIsActive(false)}
                  className="px-6 py-2.5 rounded-full bg-amber-600 text-white font-bold text-xs shadow-md hover:bg-amber-700 flex items-center gap-2 transition"
                >
                  <Pause className="w-4 h-4 fill-current" />
                  <span>Pause</span>
                </button>
              )}

              {timerSeconds > 0 && (
                <button
                  onClick={handleFinishSession}
                  className="px-6 py-2.5 rounded-full bg-emerald-700 text-white font-bold text-xs shadow-md hover:bg-emerald-800 flex items-center gap-2 transition"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>Complete Session</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* POST-SESSION LOG & STATS SUMMARY */
          <div className="space-y-4">
            <div className="p-4 bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 rounded-xl flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold text-sm">Session Completed!</p>
                <p className="text-xs text-stone-300">
                  Duration: {Math.max(1, Math.round(timerSeconds / 60))} minutes read.
                </p>
              </div>
            </div>

            {/* Log inputs: Start / End Page */}
            {!isAudiobook ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    Starting Page
                  </label>
                  <input
                    type="number"
                    value={startPage}
                    onChange={(e) => setStartPage(parseInt(e.target.value) || 0)}
                    className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    Ending Page
                  </label>
                  <input
                    type="number"
                    value={endPage}
                    onChange={(e) => setEndPage(parseInt(e.target.value) || 0)}
                    className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    Start Mins Listened
                  </label>
                  <input
                    type="number"
                    value={startMins}
                    onChange={(e) => setStartMins(parseInt(e.target.value) || 0)}
                    className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                    End Mins Listened
                  </label>
                  <input
                    type="number"
                    value={endMins}
                    onChange={(e) => setEndMins(parseInt(e.target.value) || 0)}
                    className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
                  />
                </div>
              </div>
            )}

            {/* Session Environment & Notes */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                  Reading Mood
                </label>
                <select
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                  className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6]"
                >
                  <option value="Atmospheric">Atmospheric</option>
                  <option value="Cozy">Cozy</option>
                  <option value="Fast-paced">Fast-paced</option>
                  <option value="Mind-bending">Mind-bending</option>
                  <option value="Relaxing">Relaxing</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                  Location
                </label>
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6]"
                >
                  <option value="Cozy Armchair">Cozy Armchair</option>
                  <option value="Bed">Bed</option>
                  <option value="Coffee Shop">Coffee Shop</option>
                  <option value="Commute">Commute</option>
                  <option value="Study">Study</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-[#f4efe6] block mb-1">
                Session Notes & Reflections
              </label>
              <textarea
                rows={2}
                placeholder="What happened in this session?"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 text-xs rounded-lg bg-[#120817] border border-[#3d2448] text-[#f4efe6] focus:outline-none focus:border-[#c5a059]"
              />
            </div>

            <button
              onClick={handleSaveAndClose}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-[#c5a059] to-[#d4af37] text-[#120817] font-bold text-xs shadow-md hover:opacity-95 transition"
            >
              Log & Save Session
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
