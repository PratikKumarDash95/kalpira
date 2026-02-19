'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useStore } from '@/store';
import { Shield, ArrowRight, ArrowLeft, MessageSquare, Clock, HelpCircle } from 'lucide-react';

const Consent: React.FC = () => {
  const router = useRouter();
  const { studyConfig, giveConsent, setStep, viewMode, initializeProfile } = useStore();

  const handleConsent = () => {
    giveConsent();
    // Initialize profile structure from study schema
    if (studyConfig?.profileSchema) {
      initializeProfile(studyConfig.profileSchema);
    }
    // Skip directly to interview (merged intake/profile into conversation)
    setStep('interview');
    router.push('/interview');
  };

  const handleBack = () => {
    setStep('setup');
    router.push('/setup');
  };

  if (!studyConfig) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <p className="text-stone-400">No study configured. Please set up a study first.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-lg w-full"
      >
        <div className="bg-stone-800/50 rounded-xl border border-stone-700 overflow-hidden">
          {/* Header */}
          <div className="bg-stone-700 p-6">
            <div className="flex items-center gap-3 mb-2">
              <Shield size={28} className="text-stone-300" />
              <h1 className="text-2xl font-bold text-white">Research Consent</h1>
            </div>
            <p className="text-stone-400 text-sm">
              {studyConfig.name}
            </p>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            <div className="prose prose-sm max-w-none text-stone-300">
              <p className="whitespace-pre-wrap">{studyConfig.consentText}</p>
            </div>

            {/* Interview Structure Foreshadowing */}
            <div className="bg-stone-800 rounded-xl p-5 space-y-4">
              <h3 className="font-semibold text-stone-100 flex items-center gap-2">
                <MessageSquare size={18} className="text-stone-400" />
                Interview Structure
              </h3>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-xs text-stone-400 flex-shrink-0 mt-0.5">1</div>
                  <div>
                    <div className="text-stone-200">Brief background questions</div>
                    <div className="text-stone-500 text-xs">Help us understand your context</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-xs text-stone-400 flex-shrink-0 mt-0.5">2</div>
                  <div>
                    <div className="text-stone-200">{studyConfig.coreQuestions.length} core questions about your experiences</div>
                    <div className="text-stone-500 text-xs">The heart of the interview</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-xs text-stone-400 flex-shrink-0 mt-0.5">
                    <HelpCircle size={12} />
                  </div>
                  <div>
                    <div className="text-stone-200">The AI may ask follow-up questions</div>
                    <div className="text-stone-500 text-xs">To better understand your perspective</div>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center text-xs text-stone-400 flex-shrink-0 mt-0.5">3</div>
                  <div>
                    <div className="text-stone-200">A final question for your feedback</div>
                    <div className="text-stone-500 text-xs">Your thoughts on the interview itself</div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-stone-700 text-stone-400 text-sm">
                <Clock size={14} />
                <span>Estimated time: 10-15 minutes</span>
              </div>
            </div>

            <div className="bg-stone-800 border border-stone-600 rounded-xl p-4 text-sm text-stone-300">
              <strong className="text-stone-100">Privacy:</strong> Your responses will be used for research purposes only.
              No personally identifying information will be shared without your consent.
            </div>
          </div>

          {/* Actions */}
          <div className="p-6 pt-0 flex gap-3">
            {viewMode !== 'participant' && (
              <button
                onClick={handleBack}
                className="px-6 py-3 border border-stone-600 text-stone-400 rounded-xl hover:bg-stone-700 transition-colors flex items-center gap-2"
              >
                <ArrowLeft size={18} /> Back
              </button>
            )}
            <button
              onClick={handleConsent}
              className="flex-1 py-3 bg-stone-600 hover:bg-stone-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2"
            >
              I Consent - Begin Interview <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default Consent;
