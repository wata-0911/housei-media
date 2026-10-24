import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/** Keep this shell outside conditional tab contents and importEpoch keys. */
export default function PlannerSectionEntrance({ children, className }: { children: ReactNode; className?: string }) {
  const shouldReduceMotion = useReducedMotion();

  return <motion.div
    className={className}
    initial={shouldReduceMotion ? false : { opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, amount: 'some' }}
    transition={shouldReduceMotion ? { duration: 0, delay: 0 } : { duration: 0.4, ease: 'easeOut' }}
  >
    {children}
  </motion.div>;
}
