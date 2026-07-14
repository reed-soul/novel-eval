import React from 'react';

interface RadarChartProps {
  data: number[]; // 0-100 范围的值，对应5个维度
  labels: string[]; // 维度名称，长度必须为 5
  size?: number; // 图表大小（宽高一致）
  color?: string; // 赛博主题的主色调（如 #00ffff）
}

export function RadarChart({
  data,
  labels,
  size = 300,
  color = '#00ffff'
}: RadarChartProps) {
  const center = size / 2;
  const radius = (size / 2) * 0.75; // 留出边缘放标签
  const numAxis = 5;
  const angleStep = (Math.PI * 2) / numAxis;

  // 计算多边形顶点的坐标
  const getPoint = (value: number, index: number, max = 100) => {
    const r = (value / max) * radius;
    // - Math.PI / 2 让第一个点在正上方
    const angle = index * angleStep - Math.PI / 2;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
    };
  };

  // 生成网格线（5级）
  const gridLevels = 5;
  const grids = Array.from({ length: gridLevels }).map((_, level) => {
    const r = ((level + 1) / gridLevels) * radius;
    const points = Array.from({ length: numAxis }).map((_, i) => {
      const angle = i * angleStep - Math.PI / 2;
      const x = center + r * Math.cos(angle);
      const y = center + r * Math.sin(angle);
      return `${x},${y}`;
    }).join(' ');
    return points;
  });

  // 生成轴线
  const axes = Array.from({ length: numAxis }).map((_, i) => {
    const angle = i * angleStep - Math.PI / 2;
    return {
      x2: center + radius * Math.cos(angle),
      y2: center + radius * Math.sin(angle),
    };
  });

  // 生成数据多边形
  const dataPoints = data.map((val, i) => {
    const p = getPoint(val, i);
    return `${p.x},${p.y}`;
  }).join(' ');

  // 标签位置
  const labelPoints = labels.map((label, i) => {
    const p = getPoint(115, i); // 标签稍微往外扩一点 (115)
    return { ...p, label };
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="overflow-visible">
      <defs>
        {/* 赛博发光滤镜 */}
        <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        {/* 渐变填充 */}
        <linearGradient id="neon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.6" />
          <stop offset="100%" stopColor={color} stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* 背景同心多边形网格 */}
      {grids.map((points, i) => (
        <polygon
          key={`grid-${i}`}
          points={points}
          fill="none"
          stroke="var(--bg-tertiary)"
          strokeWidth="1"
          strokeDasharray={i === gridLevels - 1 ? 'none' : '4,4'}
        />
      ))}

      {/* 辐射轴线 */}
      {axes.map((axis, i) => (
        <line
          key={`axis-${i}`}
          x1={center}
          y1={center}
          x2={axis.x2}
          y2={axis.y2}
          stroke="var(--bg-tertiary)"
          strokeWidth="1"
        />
      ))}

      {/* 数据面 */}
      <polygon
        points={dataPoints}
        fill="url(#neon-gradient)"
        stroke={color}
        strokeWidth="2"
        filter="url(#neon-glow)"
        style={{ transition: 'all 0.5s ease-out' }}
      />

      {/* 数据顶点圆点 */}
      {data.map((val, i) => {
        const p = getPoint(val, i);
        return (
          <circle
            key={`dot-${i}`}
            cx={p.x}
            cy={p.y}
            r="4"
            fill="var(--bg-primary)"
            stroke={color}
            strokeWidth="2"
            filter="url(#neon-glow)"
          />
        );
      })}

      {/* 文本标签 */}
      {labelPoints.map((item, i) => (
        <text
          key={`label-${i}`}
          x={item.x}
          y={item.y}
          fill="var(--text-primary)"
          fontSize="14"
          fontWeight="500"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {item.label} ({data[i].toFixed(1)})
        </text>
      ))}
    </svg>
  );
}
