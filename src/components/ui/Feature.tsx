import { IconType } from "react-icons";
import { motion } from "framer-motion";

interface FeatureProps {
  icon: IconType;
  title: string;
  description: string;
  index: number;
}

export function Feature({ icon: Icon, title, description, index }: FeatureProps) {
  return (
    <motion.div 
      className="group relative p-8 rounded-3xl border border-accent/10 dark:bg-background/50 bg-background_light/50 hover:bg-accent/5 backdrop-blur-sm transition-all duration-300"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ 
        opacity: 1, 
        y: 0,
        transition: { delay: index * 0.1 }
      }}
      whileHover={{ 
        scale: 1.02,
        transition: { type: "spring", stiffness: 300 }
      }}
      viewport={{ once: true }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="relative flex flex-col gap-4">
        <motion.div 
          className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors duration-300"
          whileHover={{ rotate: 5 }}
        >
          <Icon className="text-3xl text-accent" />
        </motion.div>
        
        <div className="space-y-3">
          <motion.h3 
            className="text-xl font-bold bg-gradient-to-r from-accent to-accent/70 bg-clip-text text-transparent"
            whileHover={{ x: 5 }}
          >
            {title}
          </motion.h3>
          <p className="dark:text-white/80 text-black/80 leading-relaxed">{description}</p>
        </div>
      </div>

      <div className="absolute -bottom-px left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
    </motion.div>
  );
} 