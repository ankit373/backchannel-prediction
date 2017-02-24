declare module 'react-pivot' {

    class ReactPivot<Row, Reduced> extends React.Component<ReactPivot.PivotProps<Row, Reduced>, {}> {
        constructor(props: ReactPivot.PivotProps<Row, Reduced>);
    }
    namespace ReactPivot {
        type Dimension<Row> = {
            value: (row: Row) => number | string | boolean,
            title: string
        }
        type Calculation<Row, Reduced> = {
            title: string,
            value: (row: Reduced) => number,
            template?: (val: number, row: Reduced) => string | number;
        }
        interface PivotProps<Row, Reduced> {
            rows: Row[];
            dimensions: Dimension<Row>[];
            activeDimensions: string[];
            hiddenColumns?: string[];
            sortBy?: string;
            solo?: {title: string, value: string}
            calculations: Calculation<Row, Reduced>[];
            reduce<T>(row: Row, reduced: Reduced): Reduced;
        }
    }
    export = ReactPivot;
}
