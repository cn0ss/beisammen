import { memo } from 'react';
import Svg, { Circle, Line, Path } from 'react-native-svg';

interface BrandMarkProps {
  size?: number;
  tone?: 'dark' | 'light';
  showAccent?: boolean;
  accentColor?: string;
}

const ACCENT_DEFAULT = '#c4654a';

export const BrandMark = memo(function BrandMark({
  size = 48,
  tone = 'dark',
  showAccent = true,
  accentColor = ACCENT_DEFAULT,
}: BrandMarkProps) {
  const strokeColor = tone === 'dark' ? '#1a1612' : '#f5f1ea';
  const height = Math.round((size * 130) / 110);

  return (
    <Svg width={size} height={height} viewBox="0 0 110 130" fill="none">
      <Line
        x1={22}
        y1={12}
        x2={22}
        y2={118}
        stroke={strokeColor}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <Path
        d="M 22 62 Q 52 52, 66 75 Q 80 98, 66 112 Q 52 122, 22 115"
        stroke={strokeColor}
        strokeWidth={8}
        fill="none"
        strokeLinecap="round"
      />
      {showAccent ? <Circle cx={95} cy={115} r={9} fill={accentColor} /> : null}
    </Svg>
  );
});
